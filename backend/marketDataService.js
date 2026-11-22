
const YahooFinance = require('yahoo-finance2').default;
const pool = require('./db');

const yahooFinance = new YahooFinance({
    suppressNotices: ['yahooSurvey']
});

// Symbols that need a separate provider or verified mapping.
const UNSUPPORTED_SYMBOLS = [
    'BND-USD',
    'VBNB-USD',
    'SHTSL',
    'TECE',
    'ADANI',
    'ETRN',
    'INRUSD',
    'EURUSD'
];

const TICKER_MAPPING = {
    WETH: 'WETH-USD',
    HKD: 'HKD=X',
    JPY: 'JPY=X'
};

async function updateMarketData(symbols = null) {
    const report = {
        requested: symbols || 'ALL',
        processed: 0,
        insertedOrUpdated: 0,
        skipped: 0,
        errors: []
    };

    const connection = await pool.getConnection();

    try {
        let assets;

        // Fetch only requested symbols during testing.
        if (symbols && symbols.length > 0) {
            const [rows] = await connection.query(
                `SELECT Symbol, Type
                 FROM trackers
                 WHERE Symbol IN (?)
                 ORDER BY Type, Symbol`,
                [symbols]
            );

            assets = rows;
        } else {
            const [rows] = await connection.query(
                `SELECT Symbol, Type
                 FROM trackers
                 ORDER BY Type, Symbol`
            );

            assets = rows;
        }

        if (symbols && assets.length !== symbols.length) {
            const found = new Set(assets.map(asset => asset.Symbol));

            symbols.forEach(symbol => {
                if (!found.has(symbol)) {
                    report.errors.push({
                        symbol,
                        error: 'Symbol not found in trackers table'
                    });
                }
            });
        }

        for (const asset of assets) {
            const { Symbol, Type } = asset;

            try {
                if (UNSUPPORTED_SYMBOLS.includes(Symbol)) {
                    report.skipped++;
                    console.log(`Skipped ${Symbol}: mapping required`);
                    continue;
                }

                const ticker = TICKER_MAPPING[Symbol] || Symbol;

                // Find the latest stored date for this asset.
                const [latestRows] = await connection.query(
                    `SELECT MAX(Date) AS latestDate
                     FROM market_data
                     WHERE Symbol = ?`,
                    [Symbol]
                );

                const latestDate = latestRows[0].latestDate;

                // Fetch only dates after the latest stored date.
                const period1 = latestDate
                    ? new Date(
                        new Date(latestDate).getTime() + 86400000
                    ).toISOString().slice(0, 10)
                    : '2023-01-01';

                const period2 = new Date(
                    Date.now() + 86400000
                ).toISOString().slice(0, 10);

                const result = await yahooFinance.chart(ticker, {
                    period1,
                    period2,
                    interval: '1d'
                });

                const quotes = result.quotes || [];

                if (quotes.length === 0) {
                    report.skipped++;
                    console.log(`No new data for ${Symbol}`);
                    continue;
                }

                for (const quote of quotes) {
                    if (!quote.date || quote.close == null) {
                        continue;
                    }

                    const date = quote.date.toISOString().slice(0, 10);

                    const [insertResult] = await connection.query(
                        `INSERT INTO market_data
                        (
                            Symbol,
                            Type,
                            Date,
                            \`Open\`,
                            \`High\`,
                            \`Low\`,
                            \`Close\`,
                            \`Adj Close\`,
                            Volume
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)

                        ON DUPLICATE KEY UPDATE
                            \`Open\` = VALUES(\`Open\`),
                            \`High\` = VALUES(\`High\`),
                            \`Low\` = VALUES(\`Low\`),
                            \`Close\` = VALUES(\`Close\`),
                            \`Adj Close\` = VALUES(\`Adj Close\`),
                            Volume = VALUES(Volume)`,
                        [
                            Symbol,
                            Type,
                            `${date} 00:00:00`,
                            quote.open ?? null,
                            quote.high ?? null,
                            quote.low ?? null,
                            quote.close,
                            quote.adjclose ?? null,
                            quote.volume ?? null
                        ]
                    );

                    report.insertedOrUpdated++;
                }

                report.processed++;

                console.log(
                    `Updated ${Symbol}: ${quotes.length} records`
                );

            } catch (error) {
                report.errors.push({
                    symbol: Symbol,
                    error: error.message
                });

                console.error(
                    `Failed ${Symbol}:`,
                    error.message
                );
            }
        }

        return report;

    } finally {
        connection.release();
    }
}

module.exports = { updateMarketData };
