import { logger } from "../src/common/utils.js";
import { fetchGithubProfileData } from "../src/fetchers/portofolio-fetcher.js";

export default async (req, res) => {
  const { username, cache_seconds, langs_count, include_all_commits } =
    req.query;
  res.setHeader("Content-Type", "application/json");

  try {
    const data = await fetchGithubProfileData(
      username,
      langs_count || 10,
      include_all_commits,
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
    res.send("Something went wrong: " + err.message);
  }
};
