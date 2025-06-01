// Enhanced version with better error handling and graceful degradation
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const USER_AGENT = "weather-mcp-app/1.0";
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

// Halden coordinates
const HALDEN_LAT = 59.1313;
const HALDEN_LON = 11.3871;

// Initialize the MCP server
const server = new McpServer({
  name: "halden-weather",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Fetch Halden weather forecast from YR API
async function fetchHaldenForecast() {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${HALDEN_LAT}&lon=${HALDEN_LON}`;

  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `YR API responded with status ${response.status}: ${response.statusText}`
      );
    }
    const data = await response.json();
    console.error(
      `✅ Successfully fetched YR data for Halden (${data.properties.timeseries.length} time points)`
    );
    return data;
  } catch (err) {
    console.error("❌ Failed to fetch YR weather data:", err.message);
    return null;
  }
}

/**
 * Perform a search using Brave Search API
 * @param {string} query - The search query
 * @param {number} count - Number of results to return (default 3)
 * @returns {Promise<Object|null>} Search results or null on error
 */

async function braveSearch(query, count = 3) {
  if (!BRAVE_API_KEY) {
    console.error(
      "⚠️  Brave API key not configured - search functionality disabled"
    );
    return null;
  }

  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.append("q", query);
  url.searchParams.append("count", count.toString());
  url.searchParams.append("country", "NO");

  const headers = {
    Accept: "application/json",
    "X-Subscription-Token": BRAVE_API_KEY,
    "User-Agent": USER_AGENT,
  };

  try {
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      console.error(`Brave Search API error: ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.error("Search request failed:", err.message);
    return null;
  }
}

// Format weather icon based on YR symbol code
function formatWeatherIcon(symbolCode) {
  if (!symbolCode) return "🌤️";

  if (symbolCode.includes("rain")) return "🌧️";
  if (symbolCode.includes("snow")) return "❄️";
  if (symbolCode.includes("thunder")) return "⛈️";
  if (symbolCode.includes("fog")) return "🌫️";
  if (symbolCode.includes("cloudy")) return "☁️";
  if (symbolCode.includes("fair")) return "🌤️";
  if (symbolCode.includes("clear")) return "☀️";

  return "🌤️";
}

// Tool 1: fetch current weather in Halden
server.tool(
  "get-current-weather",
  "Get current weather conditions in Halden using YR (Norwegian Meteorological Institute) data",
  {},
  async () => {
    const data = await fetchHaldenForecast();
    if (!data) {
      return {
        content: [
          {
            type: "text",
            text: "❌ Unable to fetch current weather data from YR API. Please try again later.",
          },
        ],
      };
    }

    const current = data.properties.timeseries[0];
    const details = current.data.instant.details;
    const next1h = current.data.next_1_hours;

    const icon = formatWeatherIcon(next1h?.summary?.symbol_code);

    const output = [
      `${icon} Current weather in Halden (via YR.no):`,
      `Temperature: ${details.air_temperature}°C`,
      `Wind: ${details.wind_speed} m/s`,
      `Humidity: ${details.relative_humidity}%`,
      `Pressure: ${details.air_pressure_at_sea_level} hPa`,
    ].join("\n");

    return { content: [{ type: "text", text: output }] };
  }
);

// Tool 2: Hourly forecast for next 12 hours
server.tool(
  "get-hourly-forecast",
  "Get hourly weather forecast for Halden (next 12 hours)",
  {},
  async () => {
    const data = await fetchHaldenForecast();
    if (!data) {
      return {
        content: [{ type: "text", text: "Failed to get forecast data." }],
      };
    }

    const hourly = data.properties.timeseries.slice(0, 12).map((entry) => {
      const time = new Date(entry.time);
      const hour = time.getHours();
      const details = entry.data.instant.details;
      const next1h = entry.data.next_1_hours;

      const icon = formatWeatherIcon(next1h?.summary?.symbol_code);
      const temp = details.air_temperature;
      const wind = details.wind_speed;
      const precip = next1h?.details?.precipitation_amount || 0;

      return `${hour}:00 ${icon} ${temp}°C, ${wind} m/s${
        precip > 0 ? `, ${precip}mm rain` : ""
      }`;
    });

    const output = [
      "🕐 Hourly forecast for Halden (next 12 hours):",
      "",
      ...hourly,
    ].join("\n");

    return { content: [{ type: "text", text: output }] };
  }
);

// Tool 3: 3-day weather forecast
server.tool(
  "get-3day-forecast",
  "Get 3-day weather forecast for Halden",
  {},
  async () => {
    const data = await fetchHaldenForecast();
    if (!data) {
      return {
        content: [{ type: "text", text: "Failed to get forecast data." }],
      };
    }

    const dailyData = {};

    // Group by day
    data.properties.timeseries.forEach((entry) => {
      const date = new Date(entry.time);
      const dayKey = date.toISOString().split("T")[0];

      if (!dailyData[dayKey]) {
        dailyData[dayKey] = {
          temps: [],
          conditions: [],
          precipitation: 0,
        };
      }

      dailyData[dayKey].temps.push(entry.data.instant.details.air_temperature);

      if (entry.data.next_1_hours?.summary?.symbol_code) {
        dailyData[dayKey].conditions.push(
          entry.data.next_1_hours.summary.symbol_code
        );
      }

      if (entry.data.next_1_hours?.details?.precipitation_amount) {
        dailyData[dayKey].precipitation +=
          entry.data.next_1_hours.details.precipitation_amount;
      }
    });

    const days = Object.entries(dailyData)
      .slice(0, 3)
      .map(([date, data]) => {
        const dayName = new Date(date).toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        });
        const minTemp = Math.min(...data.temps);
        const maxTemp = Math.max(...data.temps);
        const mostCommon = data.conditions
          .sort(
            (a, b) =>
              data.conditions.filter((v) => v === a).length -
              data.conditions.filter((v) => v === b).length
          )
          .pop();
        const icon = formatWeatherIcon(mostCommon);
        const rain = data.precipitation.toFixed(1);

        return `${icon} ${dayName}: ${minTemp}°C - ${maxTemp}°C${
          rain > 0 ? `, ${rain}mm rain` : ""
        }`;
      });

    const output = ["📅 3-day forecast for Halden:", "", ...days].join("\n");

    return { content: [{ type: "text", text: output }] };
  }
);

// Tool 4: Weather-dependent activity suggestions
server.tool(
  "suggest-activities (Brave Search)",
  "Get activity suggestions based on current Halden weather",
  {},
  async () => {
    const data = await fetchHaldenForecast();
    if (!data) {
      return {
        content: [
          {
            type: "text",
            text: "❌ Unable to get weather data for activity suggestions.",
          },
        ],
      };
    }

    const current = data.properties.timeseries[0];
    const temp = current.data.instant.details.air_temperature;
    const wind = current.data.instant.details.wind_speed;
    const next1h = current.data.next_1_hours;
    const hasRain = next1h?.details?.precipitation_amount > 0;

    let suggestions = [];
    let searchQuery = "Halden Norway ";

    if (hasRain) {
      suggestions.push("☔ Indoor activities recommended");
      searchQuery += "indoor activities museums cafes";
    } else if (temp > 15) {
      suggestions.push("🌞 Great weather for outdoor activities");
      searchQuery += "hiking parks outdoor activities";
    } else if (temp < 5) {
      suggestions.push("🧊 Cold weather - indoor or winter activities");
      searchQuery += "winter activities indoor venues";
    } else {
      suggestions.push(
        "🚶 Mild weather - good for walking or light outdoor activities"
      );
      searchQuery += "walking trails parks cafes";
    }

    if (wind > 10) {
      suggestions.push("💨 Windy conditions - sheltered activities preferred");
    }

    // Search for relevant activities if API key available
    let activityResults = "";
    if (BRAVE_API_KEY) {
      const results = await braveSearch(searchQuery, 2);
      if (results?.web?.results?.length) {
        activityResults =
          "\n\n🎯 Suggested places:\n" +
          results.web.results
            .map((result, i) => `${i + 1}. ${result.title}\n   ${result.url}`)
            .join("\n\n");
      }
    } else {
      activityResults =
        "\n\n💡 Enable search with Brave API key for specific venue suggestions";
    }

    const output = [
      `🎯 Activity suggestions for Halden (${temp}°C, ${wind} m/s wind):`,
      "",
      ...suggestions,
      activityResults,
    ].join("\n");

    return { content: [{ type: "text", text: output }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Status check
  const hasSearch = BRAVE_API_KEY ? "✅" : "❌";
  console.error("🌤️  Halden Weather MCP Server running...");
  console.error(`   📡 YR API: ✅ Ready`);
  console.error(
    `   🔍 Search: ${hasSearch} ${
      BRAVE_API_KEY ? "Ready" : "Disabled (no API key)"
    }`
  );
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
