// @ts-check
import * as dotenv from "dotenv";
import { CustomError, MissingParamError, request } from "../common/utils.js";
import { retryer } from "../common/retryer.js";
import { calculateRank } from "../calculateRank.js";
import { totalCommitsFetcher } from "./stats-fetcher.js";

dotenv.config();

const UNIFIED_GRAPHQL_QUERY = `
  query UnifiedProfileQuery($login: String!, $after: String) {
    user(login: $login) {
      # Basic Profile Info
      name
      login
      avatarUrl
      starredRepositories {
        totalCount
      }
      followers {
        totalCount
      }
      following {
        totalCount
      }

      # Contribution Stats
      contributionsCollection {
        totalCommitContributions,
        totalPullRequestReviewContributions
      }
      pullRequests(first: 1) {
        totalCount
      }
      issues(first: 1) {
        totalCount
      }

      repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
        totalCount
      }
      
      # Repositories (paginated)
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: {field: STARGAZERS, direction: DESC}, after: $after) {
        totalCount
        nodes {
          name
          description
          url
          forkCount
          stargazerCount
          diskUsage
          createdAt
          updatedAt
          isPrivate
          languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
            edges {
              size
              node {
                color
                name
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// A single fetcher for our unified GraphQL query.
const graphqlFetcher = (variables, token) => {
  return request(
    {
      query: UNIFIED_GRAPHQL_QUERY,
      variables,
    },
    {
      Authorization: `bearer ${token}`,
    },
  );
};

/**
 * @typedef {import("./types").PortfolioData} PortfolioData Portfolio data.
 */

/**
 * Fetch stats for a given username.
 *
 * @param {string} username GitHub username.
 * @param {boolean} include_all_commits Include all commits.
 * @param {string[]} exclude_repo Repositories to exclude.
 *
 * @returns {Promise<PortfolioData>} Stats data.
 */
const fetchGithubProfileData = async (
  username,
  langs_count,
  include_all_commits,
  exclude_repo = [],
) => {
  if (!username) {
    throw new MissingParamError(["username"]);
  }

  let allRepos = [];
  let userProfileData = null;
  let hasNextPage = true;
  let endCursor = null;

  // Loop to handle paginated repositories
  while (hasNextPage) {
    const { data: res } = await retryer(graphqlFetcher, {
      login: username,
      after: endCursor,
    });
    if (res.errors) {
      // Handle GraphQL errors, especially user not found
      if (res.errors[0].type === "NOT_FOUND") {
        throw new CustomError(
          res.errors[0].message || "Could not fetch user.",
          "USER_NOT_FOUND",
        );
      }
      throw new CustomError("GraphQL Error", "GRAPHQL_ERROR");
    }

    const user = res.data.user;
    if (!userProfileData) {
      userProfileData = user;
    }

    allRepos.push(...user.repositories.nodes);
    hasNextPage = user.repositories.pageInfo.hasNextPage;
    endCursor = user.repositories.pageInfo.endCursor;
  }

  // Filter out excluded repositories
  let repoToHide = new Set(exclude_repo);
  allRepos = allRepos.filter((repo) => !repoToHide.has(repo.name));

  // Process Top Languages
  const langMap = allRepos
    .filter((repo) => repo.languages.edges.length > 0)
    .reduce((acc, repo) => repo.languages.edges.concat(acc), [])
    .reduce((acc, lang) => {
      if (!acc[lang.node.name]) {
        acc[lang.node.name] = { ...lang.node, size: 0 };
      }
      acc[lang.node.name].size += lang.size;
      return acc;
    }, {});

  const topLangs = Object.values(langMap)
    .sort((a, b) => b.size - a.size)
    .slice(0, langs_count);

  // Process Stats
  const totalStars = allRepos.reduce(
    (prev, curr) => prev + curr.stargazerCount,
    0,
  );
  const totalCommits = include_all_commits
    ? await totalCommitsFetcher(username)
    : userProfileData.contributionsCollection.totalCommitContributions;
  const stats = {
    totalStars,
    totalCommits,
    totalReviews:
      userProfileData.contributionsCollection
        .totalPullRequestReviewContributions,
    totalPRs: userProfileData.pullRequests.totalCount,
    totalIssues: userProfileData.issues.totalCount,
    contributedTo: userProfileData.repositoriesContributedTo.totalCount,
  };

  // Calculate Rank
  const rank = calculateRank({
    all_commits: include_all_commits,
    commits: stats.totalCommits,
    prs: stats.totalPRs,
    reviews: stats.totalReviews,
    issues: stats.totalIssues,
    repos: allRepos.length,
    stars: stats.totalStars,
    followers: userProfileData.followers.totalCount,
  });

  return {
    profile: {
      username: userProfileData.login,
      name: userProfileData.name || userProfileData.login,
      avatarUrl: userProfileData.avatarUrl,
      followers: userProfileData.followers.totalCount,
      following: userProfileData.following.totalCount,
      staredRepos: userProfileData.starredRepositories.totalCount,
      totalRepos: allRepos.length,
    },
    stats: {
      ...stats,
      rank,
    },
    topLanguages: topLangs,
    repositories: allRepos.map((repo) => ({
      name: repo.name,
      url: repo.url,
      description: repo.description,
      stars: repo.stargazerCount,
      forks: repo.forkCount,
      sizeInKB: repo.diskUsage,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
      isPrivate: repo.isPrivate,
      languages: repo.languages.edges.map((edge) => ({
        size: edge.size,
        ...edge.node,
      })),
    })),
  };
};

export { fetchGithubProfileData };
