
const Groq = require("groq-sdk");
const pool = require("./db");

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

const dbSchema = `
Table market_data:
- Symbol VARCHAR
- Type VARCHAR
- Date DATETIME
- Open DOUBLE
- High DOUBLE
- Low DOUBLE
- Close DOUBLE
- Adj Close DOUBLE
- Volume BIGINT

Table trackers:
- Symbol VARCHAR
- Type TEXT
- Logo TEXT
`;

const systemPrompt = `
You are an intelligent financial market data assistant.

You have access to a MySQL database with this schema:

${dbSchema}

RULES:

1. For questions requiring database information, return ONLY one valid MySQL SELECT query.
2. Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE or other modifying queries.
3. Never use SELECT *.
4. Always use appropriate LIMIT values.
5. Use exact database column names.
6. For stock all-time high questions, use MAX(High).
7. For stock all-time low questions, use MIN(Low).
8. For latest price questions, order by Date DESC and LIMIT 1.
9. Match company names to ticker symbols where possible.
10. Apple = AAPL, Microsoft = MSFT, Amazon = AMZN, Tesla = TSLA.
11. If the user asks a general question, respond conversationally without SQL.
12. Do not invent market prices or database results.
13. Historical database values must not be described as live prices.

Examples:

User: What is Apple's all-time high?

SELECT Symbol, MAX(High) AS all_time_high
FROM market_data
WHERE Symbol = 'AAPL';

User: What is Bitcoin's latest closing price?

SELECT Symbol, Close, Date
FROM market_data
WHERE Symbol = 'BTC-USD'
ORDER BY Date DESC
LIMIT 1;

User: Show the top 5 stocks by latest closing price.

SELECT m.Symbol, m.Close, m.Date
FROM market_data m
INNER JOIN (
  SELECT Symbol, MAX(Date) AS latest_date
  FROM market_data
  WHERE Type = 'Stock'
  GROUP BY Symbol
) latest
ON m.Symbol = latest.Symbol
AND m.Date = latest.latest_date
ORDER BY m.Close DESC
LIMIT 5;

For database questions, output raw SQL only.
`;

function extractSQL(response) {
    return response
        .replace(/```(?:sql)?/gi, "")
        .replace(/```/g, "")
        .trim();
}

function isSafeSelect(query) {
    const normalized = query.trim();

    if (!/^SELECT\b/i.test(normalized)) {
        return false;
    }

    // Reject multiple SQL statements
    if (normalized.replace(/;\s*$/, "").includes(";")) {
        return false;
    }

    // Reject modifying or administrative SQL keywords
    const forbidden =
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|CALL|EXEC|UNION|INTO|LOAD_FILE|SLEEP|BENCHMARK)\b/i;

    return !forbidden.test(normalized);
}

async function processMessage(message, history = []) {
    try {
        const formattedHistory = history.slice(-5).map((h) => ({
            role: h.role === "ai" ? "assistant" : "user",
            content: h.content,
        }));

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: systemPrompt,
                },
                ...formattedHistory,
                {
                    role: "user",
                    content: message,
                },
            ],
            model: "openai/gpt-oss-120b",
            temperature: 0.1,
        });

        const firstResponse =
            completion.choices[0]?.message?.content?.trim();

        if (!firstResponse) {
            throw new Error("Empty response from AI model");
        }

        // General conversational response
        if (!/^SELECT\b/i.test(firstResponse.replace(/^```(?:sql)?/i, "").trim())) {
            return {
                content: firstResponse,
            };
        }

        // Extract and validate SQL
        const query = extractSQL(firstResponse);

        console.log("\n========== AI GENERATED SQL ==========");
        console.log(query);
        console.log("======================================\n");

        if (!isSafeSelect(query)) {
            console.error("Rejected unsafe SQL query");

            return {
                content: "I couldn't generate a safe database query. Please rephrase your question.",
            };
        }

        let queryResult;

        try {
            const [rows] = await pool.query(query);
            queryResult = rows;

            console.log("SQL RESULT:", JSON.stringify(rows).substring(0, 1500));
        } catch (dbError) {
            console.error("Database Query Error:", dbError.message);

            return {
                content: "I generated a database query, but MySQL returned an error. Please try rephrasing your question.",
                query,
                error: dbError.message,
            };
        }

        // Ask AI to explain actual database results
        const finalPrompt = `
The user asked: "${message}"

Executed SQL:
${query}

Actual database result:
${JSON.stringify(queryResult).substring(0, 4000)}

Explain the result in a friendly, clear manner.

Rules:
- Use only the supplied database result.
- Never invent values.
- If no rows were returned, clearly say no matching data was found.
- Format prices and volumes readably.
- Mention that prices are historical database values, not necessarily live market prices.
- Do not display SQL in your answer.
`;

        const finalCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "You are a helpful financial market data assistant.",
                },
                {
                    role: "user",
                    content: finalPrompt,
                },
            ],
            model: "openai/gpt-oss-120b",
            temperature: 0.3,
        });

        return {
            content:
                finalCompletion.choices[0]?.message?.content ||
                "I retrieved the data but couldn't generate an explanation.",
            query,
        };

    } catch (error) {
        console.error("AI Service Error:", error);

        return {
            content: "Sorry, I encountered an error while processing your request.",
            error: error.message,
        };
    }
}

module.exports = {
    processMessage,
};
