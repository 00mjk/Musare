import mongoose from "mongoose";
import async from "async";

import { isAdminRequired } from "./hooks";

// eslint-disable-next-line
import moduleManager from "../../index";

const DBModule = moduleManager.modules.db;
const UtilsModule = moduleManager.modules.utils;
const YouTubeModule = moduleManager.modules.youtube;
const WSModule = moduleManager.modules.ws;
const CacheModule = moduleManager.modules.cache;

CacheModule.runJob("SUB", {
	channel: "youtube.removeYoutubeApiRequest",
	cb: requestId => {
		WSModule.runJob("EMIT_TO_ROOM", {
			room: `view-api-request.${requestId}`,
			args: ["event:youtubeApiRequest.removed"]
		});

		WSModule.runJob("EMIT_TO_ROOM", {
			room: "admin.youtube",
			args: ["event:admin.youtubeApiRequest.removed", { data: { requestId } }]
		});
	}
});

CacheModule.runJob("SUB", {
	channel: "youtube.removeVideos",
	cb: videoIds => {
		const videos = Array.isArray(videoIds) ? videoIds : [videoIds];
		videos.forEach(videoId => {
			WSModule.runJob("EMIT_TO_ROOM", {
				room: `view-youtube-video.${videoId}`,
				args: ["event:youtubeVideo.removed"]
			});

			WSModule.runJob("EMIT_TO_ROOM", {
				room: "admin.youtubeVideos",
				args: ["event:admin.youtubeVideo.removed", { data: { videoId } }]
			});
		});
	}
});

export default {
	/**
	 * Returns details about the YouTube quota usage
	 *
	 * @returns {{status: string, data: object}}
	 */
	getQuotaStatus: isAdminRequired(function getQuotaStatus(session, fromDate, cb) {
		YouTubeModule.runJob("GET_QUOTA_STATUS", { fromDate }, this)
			.then(response => {
				this.log("SUCCESS", "YOUTUBE_GET_QUOTA_STATUS", `Getting quota status was successful.`);
				return cb({ status: "success", data: { status: response.status } });
			})
			.catch(async err => {
				err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
				this.log("ERROR", "YOUTUBE_GET_QUOTA_STATUS", `Getting quota status failed. "${err}"`);
				return cb({ status: "error", message: err });
			});
	}),

	/**
	 * Gets api requests, used in the admin youtube page by the AdvancedTable component
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param page - the page
	 * @param pageSize - the size per page
	 * @param properties - the properties to return for each news item
	 * @param sort - the sort object
	 * @param queries - the queries array
	 * @param operator - the operator for queries
	 * @param cb
	 */
	getApiRequests: isAdminRequired(async function getApiRequests(
		session,
		page,
		pageSize,
		properties,
		sort,
		queries,
		operator,
		cb
	) {
		async.waterfall(
			[
				next => {
					DBModule.runJob(
						"GET_DATA",
						{
							page,
							pageSize,
							properties,
							sort,
							queries,
							operator,
							modelName: "youtubeApiRequest",
							blacklistedProperties: [],
							specialProperties: {},
							specialQueries: {}
						},
						this
					)
						.then(response => {
							next(null, response);
						})
						.catch(err => {
							next(err);
						});
				}
			],
			async (err, response) => {
				if (err && err !== true) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "YOUTUBE_GET_API_REQUESTS", `Failed to get YouTube api requests. "${err}"`);
					return cb({ status: "error", message: err });
				}
				this.log("SUCCESS", "YOUTUBE_GET_API_REQUESTS", `Fetched YouTube api requests successfully.`);
				return cb({
					status: "success",
					message: "Successfully fetched YouTube api requests.",
					data: response
				});
			}
		);
	}),

	/**
	 * Returns a specific api request
	 *
	 * @returns {{status: string, data: object}}
	 */
	getApiRequest: isAdminRequired(function getApiRequest(session, apiRequestId, cb) {
		if (!mongoose.Types.ObjectId.isValid(apiRequestId))
			return cb({ status: "error", message: "Api request id is not a valid ObjectId." });

		return YouTubeModule.runJob("GET_API_REQUEST", { apiRequestId }, this)
			.then(response => {
				this.log(
					"SUCCESS",
					"YOUTUBE_GET_API_REQUEST",
					`Getting api request with id ${apiRequestId} was successful.`
				);
				return cb({ status: "success", data: { apiRequest: response.apiRequest } });
			})
			.catch(async err => {
				err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
				this.log(
					"ERROR",
					"YOUTUBE_GET_API_REQUEST",
					`Getting api request with id ${apiRequestId} failed. "${err}"`
				);
				return cb({ status: "error", message: err });
			});
	}),

	/**
	 * Reset stored API requests
	 *
	 * @returns {{status: string, data: object}}
	 */
	resetStoredApiRequests: isAdminRequired(async function resetStoredApiRequests(session, cb) {
		async.waterfall(
			[
				next => {
					YouTubeModule.youtubeApiRequestModel.find({}, next);
				},

				(apiRequests, next) => {
					YouTubeModule.runJob("RESET_STORED_API_REQUESTS", {}, this)
						.then(() => next(null, apiRequests))
						.catch(err => next(err));
				},

				(apiRequests, next) => {
					async.eachLimit(
						apiRequests.map(apiRequest => apiRequest._id),
						1,
						(requestId, next) => {
							CacheModule.runJob(
								"PUB",
								{
									channel: "youtube.removeYoutubeApiRequest",
									value: requestId
								},
								this
							)
								.then(() => {
									next();
								})
								.catch(err => {
									next(err);
								});
						},
						err => {
							if (err) next(err);
							else next();
						}
					);
				}
			],
			async err => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log(
						"ERROR",
						"YOUTUBE_RESET_STORED_API_REQUESTS",
						`Resetting stored API requests failed. "${err}"`
					);
					return cb({ status: "error", message: err });
				}

				this.log(
					"SUCCESS",
					"YOUTUBE_RESET_STORED_API_REQUESTS",
					`Resetting stored API requests was successful.`
				);
				return cb({ status: "success", message: "Successfully reset stored YouTube API requests" });
			}
		);
	}),

	/**
	 * Remove stored API requests
	 *
	 * @returns {{status: string, data: object}}
	 */
	removeStoredApiRequest: isAdminRequired(function removeStoredApiRequest(session, requestId, cb) {
		YouTubeModule.runJob("REMOVE_STORED_API_REQUEST", { requestId }, this)
			.then(() => {
				this.log(
					"SUCCESS",
					"YOUTUBE_REMOVE_STORED_API_REQUEST",
					`Removing stored API request "${requestId}" was successful.`
				);

				CacheModule.runJob("PUB", {
					channel: "youtube.removeYoutubeApiRequest",
					value: requestId
				});

				return cb({ status: "success", message: "Successfully removed stored YouTube API request" });
			})
			.catch(async err => {
				err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
				this.log(
					"ERROR",
					"YOUTUBE_REMOVE_STORED_API_REQUEST",
					`Removing stored API request "${requestId}" failed. "${err}"`
				);
				return cb({ status: "error", message: err });
			});
	}),

	/**
	 * Gets videos, used in the admin youtube page by the AdvancedTable component
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param page - the page
	 * @param pageSize - the size per page
	 * @param properties - the properties to return for each news item
	 * @param sort - the sort object
	 * @param queries - the queries array
	 * @param operator - the operator for queries
	 * @param cb
	 */
	getVideos: isAdminRequired(async function getVideos(
		session,
		page,
		pageSize,
		properties,
		sort,
		queries,
		operator,
		cb
	) {
		async.waterfall(
			[
				next => {
					DBModule.runJob(
						"GET_DATA",
						{
							page,
							pageSize,
							properties,
							sort,
							queries,
							operator,
							modelName: "youtubeVideo",
							blacklistedProperties: [],
							specialProperties: {},
							specialQueries: {}
						},
						this
					)
						.then(response => {
							next(null, response);
						})
						.catch(err => {
							next(err);
						});
				}
			],
			async (err, response) => {
				if (err && err !== true) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "YOUTUBE_GET_VIDEOS", `Failed to get YouTube videos. "${err}"`);
					return cb({ status: "error", message: err });
				}
				this.log("SUCCESS", "YOUTUBE_GET_VIDEOS", `Fetched YouTube videos successfully.`);
				return cb({
					status: "success",
					message: "Successfully fetched YouTube videos.",
					data: response
				});
			}
		);
	}),

	/**
	 * Get a YouTube video
	 *
	 * @returns {{status: string, data: object}}
	 */
	getVideo: isAdminRequired(function getVideo(session, identifier, createMissing, cb) {
		YouTubeModule.runJob("GET_VIDEO", { identifier, createMissing }, this)
			.then(res => {
				this.log("SUCCESS", "YOUTUBE_GET_VIDEO", `Fetching video was successful.`);

				return cb({ status: "success", message: "Successfully fetched YouTube video", data: res.video });
			})
			.catch(async err => {
				err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
				this.log("ERROR", "YOUTUBE_GET_VIDEO", `Fetching video failed. "${err}"`);
				return cb({ status: "error", message: err });
			});
	}),

	/**
	 * Remove YouTube videos
	 *
	 * @returns {{status: string, data: object}}
	 */
	removeVideos: isAdminRequired(function removeVideos(session, videoIds, cb) {
		YouTubeModule.runJob("REMOVE_VIDEOS", { videoIds }, this)
			.then(() => {
				this.log("SUCCESS", "YOUTUBE_REMOVE_VIDEOS", `Removing videos was successful.`);

				CacheModule.runJob("PUB", {
					channel: "youtube.removeVideos",
					value: videoIds
				});

				return cb({ status: "success", message: "Successfully removed YouTube videos" });
			})
			.catch(async err => {
				err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
				this.log("ERROR", "YOUTUBE_REMOVE_VIDEOS", `Removing videos failed. "${err}"`);
				return cb({ status: "error", message: err });
			});
	})
};
