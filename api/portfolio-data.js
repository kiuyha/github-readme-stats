import { logger, parseArray, parseBoolean } from "../src/common/utils.js";
import { fetchGithubProfileData } from "../src/fetchers/portfolio-fetcher.js";

export default async (req, res) => {
  const {
    username,
    cache_seconds,
    langs_count,
    include_all_commits,
    exclude_repo,
  } = req.query;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const data = await fetchGithubProfileData(
      username,
      langs_count || 10,
      parseBoolean(include_all_commits),
      parseArray(exclude_repo),
    );
    if (data) {
      const CACHE_SECONDS = cache_seconds ? parseInt(cache_seconds, 10) : 7200;
      res.setHeader(
        "Cache-Control",
        `max-age=${CACHE_SECONDS / 2}, s-maxage=${CACHE_SECONDS}`,
      );
      res.send(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    // Throw error if something went wrong.
    logger.error(err);
    res.setHeader("Cache-Control", "no-store");
    const errorResponse = {
      error: {
        message: err.message,
        type: err.type || "SERVER_ERROR",
      },
    };
    res.status(500).send(JSON.stringify(errorResponse, null, 2));
  }
};
