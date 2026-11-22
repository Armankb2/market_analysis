
import React, { useEffect, useMemo, useState } from "react";

import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

import {
    TrendingUp,
    TrendingDown,
    Activity,
    Search,
    RefreshCw,
    BarChart3,
} from "lucide-react";

const API = "http://localhost:5001/api/dashboard";

const formatPrice = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return "—";

    return Number(value).toLocaleString("en-US", {
        maximumFractionDigits: 2,
    });
};

function MarketDashboard() {
    const [summary, setSummary] = useState(null);
    const [assets, setAssets] = useState([]);
    const [selected, setSelected] = useState("BTC-USD");
    const [history, setHistory] = useState([]);
    const [category, setCategory] = useState("All");
    const [search, setSearch] = useState("");
    const [period, setPeriod] = useState("ALL");

    const [loading, setLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [error, setError] = useState("");

    // Market update states
    const [updatingMarket, setUpdatingMarket] = useState(false);
    const [updateMessage, setUpdateMessage] = useState("");

    // Load dashboard summary and assets
    const loadDashboard = async () => {
        try {
            setLoading(true);
            setError("");

            const [summaryRes, assetsRes] = await Promise.all([
                fetch(`${API}/summary`),
                fetch(`${API}/assets`),
            ]);

            if (!summaryRes.ok || !assetsRes.ok) {
                throw new Error("Unable to load market data");
            }

            const summaryData = await summaryRes.json();
            const assetsData = await assetsRes.json();

            setSummary(summaryData);
            setAssets(assetsData);

            if (
                !assetsData.some((asset) => asset.Symbol === selected) &&
                assetsData.length
            ) {
                setSelected(assetsData[0].Symbol);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Trigger market data update and monitor its status
    const handleMarketUpdate = async () => {
        if (updatingMarket) return;

        try {
            setUpdatingMarket(true);
            setUpdateMessage("Starting market data update...");

            const response = await fetch(`${API}/update`, {
                method: "POST",
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(
                    data.message || "Unable to start update"
                );
            }

            setUpdateMessage("Fetching latest market data...");

            // Poll backend until the update finishes
            while (true) {
                await new Promise((resolve) =>
                    setTimeout(resolve, 2000)
                );

                const statusResponse = await fetch(
                    `${API}/update-status`
                );

                if (!statusResponse.ok) {
                    throw new Error("Unable to check update status");
                }

                const status = await statusResponse.json();

                if (!status.running) {
                    if (status.lastError) {
                        throw new Error(status.lastError);
                    }

                    const report = status.lastReport;

                    if (!report) {
                        throw new Error(
                            "Update finished without a report"
                        );
                    }

                    setUpdateMessage(
                        `Update complete! ${report.processed ?? 0} assets processed, ${report.skipped ?? 0} skipped, ${report.errors?.length ?? 0} errors.`
                    );

                    await loadDashboard();
                    break;
                }
            }
        } catch (err) {
            setUpdateMessage(`Update failed: ${err.message}`);
        } finally {
            setUpdatingMarket(false);
        }
    };

    useEffect(() => {
        loadDashboard();
    }, []);

    // Load historical data for selected asset
    useEffect(() => {
        if (!selected) return;

        let cancelled = false;

        const loadHistory = async () => {
            try {
                setHistoryLoading(true);
                setHistory([]);

                const response = await fetch(
                    `${API}/history/${encodeURIComponent(selected)}`
                );

                if (!response.ok) {
                    throw new Error("Unable to load price history");
                }

                const data = await response.json();

                if (!cancelled) {
                    setHistory(data);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err.message);
                }
            } finally {
                if (!cancelled) {
                    setHistoryLoading(false);
                }
            }
        };

        loadHistory();

        return () => {
            cancelled = true;
        };
    }, [selected]);

    // Filter assets
    const filteredAssets = useMemo(() => {
        return assets.filter((asset) => {
            const matchesCategory =
                category === "All" ||
                asset.Type?.toLowerCase() === category.toLowerCase();

            const matchesSearch = asset.Symbol.toLowerCase().includes(
                search.toLowerCase()
            );

            return matchesCategory && matchesSearch;
        });
    }, [assets, category, search]);

    const selectedAsset = assets.find(
        (asset) => asset.Symbol === selected
    );

    // Filter chart history
    const chartData = useMemo(() => {
        if (!history.length) return [];

        const days = {
            "1M": 30,
            "3M": 90,
            "6M": 180,
            "1Y": 365,
        };

        const limit = days[period];
        const data = limit ? history.slice(-limit) : history;

        return data.map((item) => ({
            ...item,
            date: new Date(item.Date).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "2-digit",
            }),
        }));
    }, [history, period]);

    const firstPrice = chartData[0]?.Close;
    const lastPrice = chartData[chartData.length - 1]?.Close;

    const latestOHLC = history[history.length - 1];

    const change =
        firstPrice && lastPrice
            ? ((lastPrice - firstPrice) / firstPrice) * 100
            : 0;

    // Initial loading state
    if (loading) {
        return (
            <div className="market-loading">
                <Activity size={24} />
                <p>Loading market data...</p>
            </div>
        );
    }

    return (
        <div className="market-dashboard">

            {/* HEADER */}
            <header className="market-header">
                <div>
                    <div className="market-brand">
                        <BarChart3 size={24} />
                        <span>
                            MARKET<span className="brand-accent">PULSE</span>
                        </span>
                    </div>

                    <p>Financial Market Analytics Platform</p>
                </div>

                <div className="market-header-actions">
                    <button
                        className="market-refresh"
                        onClick={loadDashboard}
                        disabled={loading || updatingMarket}
                    >
                        <RefreshCw size={16} />
                        Refresh
                    </button>

                    <button
                        className="market-refresh"
                        onClick={handleMarketUpdate}
                        disabled={updatingMarket || loading}
                    >
                        <RefreshCw
                            size={16}
                            className={updatingMarket ? "spin" : ""}
                        />

                        {updatingMarket
                            ? "Updating..."
                            : "Update Market Data"}
                    </button>
                </div>
            </header>

            {/* UPDATE STATUS */}
            {updateMessage && (
                <div
                    className={
                        updateMessage.startsWith("Update failed")
                            ? "market-error"
                            : "market-update-status"
                    }
                >
                    {updateMessage}
                </div>
            )}

            {/* GENERAL ERROR */}
            {error && (
                <div className="market-error">
                    {error}
                </div>
            )}

            {/* OVERVIEW CARDS */}
            <section className="market-stats">

                <div className="market-stat-card">
                    <span>Total Assets</span>
                    <strong>{summary?.totalAssets ?? "—"}</strong>
                    <small>Unique market instruments</small>
                </div>

                <div className="market-stat-card">
                    <span>Market Records</span>
                    <strong>
                        {Number(summary?.totalRecords ?? 0).toLocaleString()}
                    </strong>
                    <small>Historical observations</small>
                </div>

                <div className="market-stat-card">
                    <span>Selected Asset</span>
                    <strong>{selectedAsset?.Symbol ?? "—"}</strong>
                    <small>
                        {selectedAsset?.Type ?? "Choose an asset"}
                    </small>
                </div>

                <div className="market-stat-card">
                    <span>Latest Close</span>
                    <strong>{formatPrice(selectedAsset?.Close)}</strong>
                    <small>
                        {selectedAsset?.Date
                            ? new Date(selectedAsset.Date).toLocaleDateString()
                            : "No price available"}
                    </small>
                </div>

            </section>

            {/* MAIN DASHBOARD LAYOUT */}
            <section className="market-main-grid">

                {/* LEFT COLUMN */}
                <div className="market-left-column">

                    {/* PRICE CHART */}
                    <div className="market-chart-panel">

                        <div className="market-panel-heading">
                            <div>
                                <h2>{selected}</h2>
                                <p>Historical closing price</p>
                            </div>

                            <div
                                className={`market-change ${change >= 0 ? "positive" : "negative"
                                    }`}
                            >
                                {change >= 0 ? (
                                    <TrendingUp size={16} />
                                ) : (
                                    <TrendingDown size={16} />
                                )}

                                {change.toFixed(2)}%
                            </div>
                        </div>

                        {/* PERIOD FILTERS */}
                        <div className="market-periods">
                            {["1M", "3M", "6M", "1Y", "ALL"].map((p) => (
                                <button
                                    key={p}
                                    className={period === p ? "active" : ""}
                                    onClick={() => setPeriod(p)}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>

                        {/* CHART */}
                        <div className="market-chart">

                            {historyLoading ? (
                                <div className="market-empty">
                                    <Activity size={28} />
                                    <p>Loading price history...</p>
                                </div>
                            ) : chartData.length ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData}>

                                        <defs>
                                            <linearGradient
                                                id="priceGradient"
                                                x1="0"
                                                y1="0"
                                                x2="0"
                                                y2="1"
                                            >
                                                <stop
                                                    offset="0%"
                                                    stopColor="#38bdf8"
                                                    stopOpacity={0.35}
                                                />

                                                <stop
                                                    offset="95%"
                                                    stopColor="#38bdf8"
                                                    stopOpacity={0}
                                                />
                                            </linearGradient>
                                        </defs>

                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            stroke="#263244"
                                        />

                                        <XAxis
                                            dataKey="date"
                                            minTickGap={35}
                                            stroke="#94a3b8"
                                        />

                                        <YAxis
                                            domain={["auto", "auto"]}
                                            stroke="#94a3b8"
                                            tickFormatter={(value) =>
                                                Number(value).toLocaleString()
                                            }
                                            width={75}
                                        />

                                        <Tooltip
                                            contentStyle={{
                                                background: "#111827",
                                                border: "1px solid #334155",
                                                borderRadius: 8,
                                                color: "#fff",
                                            }}
                                            formatter={(value) => [
                                                formatPrice(value),
                                                "Close",
                                            ]}
                                        />

                                        <Area
                                            type="monotone"
                                            dataKey="Close"
                                            stroke="#38bdf8"
                                            strokeWidth={2}
                                            fill="url(#priceGradient)"
                                            dot={false}
                                            activeDot={{ r: 5 }}
                                        />

                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="market-empty">
                                    <Activity size={28} />
                                    <p>No historical data available</p>
                                </div>
                            )}

                        </div>
                    </div>

                    {/* OHLC DETAILS */}
                    <div className="market-ohlc-grid">

                        {[
                            ["Open", latestOHLC?.Open],
                            ["High", latestOHLC?.High],
                            ["Low", latestOHLC?.Low],
                            ["Close", latestOHLC?.Close],
                            ["Volume", latestOHLC?.Volume],
                        ].map(([label, value]) => (

                            <div className="market-ohlc-card" key={label}>
                                <span>{label}</span>

                                <strong>
                                    {value == null
                                        ? "—"
                                        : label === "Volume"
                                            ? Number(value).toLocaleString()
                                            : formatPrice(value)}
                                </strong>
                            </div>

                        ))}

                    </div>

                </div>

                {/* RIGHT COLUMN - ASSET SELECTOR */}
                <div className="market-assets-panel">

                    <div className="market-assets-heading">
                        <h3>Market Assets</h3>
                        <span>{filteredAssets.length} assets</span>
                    </div>

                    {/* SEARCH */}
                    <div className="market-search">
                        <Search size={16} />

                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search assets..."
                        />
                    </div>

                    {/* CATEGORY FILTER */}
                    <div className="market-categories">

                        {[
                            "All",
                            "Stock",
                            "Crypto",
                            "ETFs",
                            "MF",
                            "Currency",
                        ].map((c) => (

                            <button
                                key={c}
                                className={category === c ? "active" : ""}
                                onClick={() => setCategory(c)}
                            >
                                {c}
                            </button>

                        ))}

                    </div>

                    {/* ASSET LIST */}
                    <div className="market-assets-list">

                        {filteredAssets.map((asset) => (

                            <button
                                key={asset.Symbol}
                                className={`market-asset-row ${selected === asset.Symbol ? "selected" : ""
                                    }`}
                                onClick={() => setSelected(asset.Symbol)}
                            >

                                {/* LOGO WITH FALLBACK */}
                                {asset.Logo ? (
                                    <img
                                        src={asset.Logo}
                                        alt=""
                                        onError={(e) => {
                                            e.currentTarget.style.display = "none";

                                            const fallback =
                                                e.currentTarget.nextElementSibling;

                                            if (fallback) {
                                                fallback.style.display = "grid";
                                            }
                                        }}
                                    />
                                ) : null}

                                <span
                                    className="asset-placeholder"
                                    style={{
                                        display: asset.Logo ? "none" : "grid",
                                    }}
                                >
                                    {asset.Symbol.slice(0, 1)}
                                </span>

                                <span className="asset-info">
                                    <strong>{asset.Symbol}</strong>
                                    <small>{asset.Type}</small>
                                </span>

                                <strong className="asset-price">
                                    {formatPrice(asset.Close)}
                                </strong>

                            </button>

                        ))}

                        {!filteredAssets.length && (
                            <p className="market-no-results">
                                No matching assets
                            </p>
                        )}

                    </div>
                </div>

            </section>

            {/* FOOTER */}
            <footer className="market-footer">

                <span>
                    MarketPulse · Historical market analytics
                </span>

                <span>
                    Latest database date:{" "}
                    {summary?.latestDate
                        ? new Date(summary.latestDate).toLocaleDateString()
                        : "—"}
                </span>

            </footer>

        </div>
    );
}

export default MarketDashboard;
