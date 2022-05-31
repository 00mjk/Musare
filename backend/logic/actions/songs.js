import async from "async";

import { isAdminRequired, isLoginRequired } from "./hooks";

// eslint-disable-next-line
import moduleManager from "../../index";

const DBModule = moduleManager.modules.db;
const UtilsModule = moduleManager.modules.utils;
const WSModule = moduleManager.modules.ws;
const CacheModule = moduleManager.modules.cache;
const SongsModule = moduleManager.modules.songs;
const PlaylistsModule = moduleManager.modules.playlists;
const StationsModule = moduleManager.modules.stations;
const RatingsModule = moduleManager.modules.ratings;
const YouTubeModule = moduleManager.modules.youtube;

CacheModule.runJob("SUB", {
	channel: "song.updated",
	cb: async data => {
		const songModel = await DBModule.runJob("GET_MODEL", {
			modelName: "song"
		});

		songModel.findOne({ _id: data.songId }, (err, song) => {
			WSModule.runJob("EMIT_TO_ROOMS", {
				rooms: ["import-album", "admin.songs", `edit-song.${data.songId}`, "edit-songs"],
				args: ["event:admin.song.updated", { data: { song, oldStatus: data.oldStatus } }]
			});
		});
	}
});

CacheModule.runJob("SUB", {
	channel: "song.removed",
	cb: async data => {
		WSModule.runJob("EMIT_TO_ROOMS", {
			rooms: ["import-album", "admin.songs", `edit-song.${data.songId}`, "edit-songs"],
			args: ["event:admin.song.removed", { data }]
		});
	}
});

export default {
	/**
	 * Returns the length of the songs list
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param cb
	 */
	length: isAdminRequired(async function length(session, cb) {
		const songModel = await DBModule.runJob("GET_MODEL", { modelName: "song" }, this);
		async.waterfall(
			[
				next => {
					songModel.countDocuments({}, next);
				}
			],
			async (err, count) => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "SONGS_LENGTH", `Failed to get length from songs. "${err}"`);
					return cb({ status: "error", message: err });
				}
				this.log("SUCCESS", "SONGS_LENGTH", `Got length from songs successfully.`);
				return cb({ status: "success", message: "Successfully got length of songs.", data: { length: count } });
			}
		);
	}),

	/**
	 * Gets songs, used in the admin songs page by the AdvancedTable component
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param page - the page
	 * @param pageSize - the size per page
	 * @param properties - the properties to return for each song
	 * @param sort - the sort object
	 * @param queries - the queries array
	 * @param operator - the operator for queries
	 * @param cb
	 */
	getData: isAdminRequired(async function getSet(session, page, pageSize, properties, sort, queries, operator, cb) {
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
							modelName: "song",
							blacklistedProperties: [],
							specialProperties: {
								requestedBy: [
									{
										$addFields: {
											requestedByOID: {
												$convert: {
													input: "$requestedBy",
													to: "objectId",
													onError: "unknown",
													onNull: "unknown"
												}
											}
										}
									},
									{
										$lookup: {
											from: "users",
											localField: "requestedByOID",
											foreignField: "_id",
											as: "requestedByUser"
										}
									},
									{
										$addFields: {
											requestedByUsername: {
												$ifNull: ["$requestedByUser.username", "unknown"]
											}
										}
									},
									{
										$project: {
											requestedByOID: 0,
											requestedByUser: 0
										}
									}
								],
								verifiedBy: [
									{
										$addFields: {
											verifiedByOID: {
												$convert: {
													input: "$verifiedBy",
													to: "objectId",
													onError: "unknown",
													onNull: "unknown"
												}
											}
										}
									},
									{
										$lookup: {
											from: "users",
											localField: "verifiedByOID",
											foreignField: "_id",
											as: "verifiedByUser"
										}
									},
									{
										$unwind: {
											path: "$verifiedByUser",
											preserveNullAndEmptyArrays: true
										}
									},
									{
										$addFields: {
											verifiedByUsername: {
												$ifNull: ["$verifiedByUser.username", "unknown"]
											}
										}
									},
									{
										$project: {
											verifiedByOID: 0,
											verifiedByUser: 0
										}
									}
								]
							},
							specialQueries: {
								requestedBy: newQuery => ({
									$or: [newQuery, { requestedByUsername: newQuery.requestedBy }]
								}),
								verifiedBy: newQuery => ({
									$or: [newQuery, { verifiedByUsername: newQuery.verifiedBy }]
								})
							}
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
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "SONGS_GET_DATA", `Failed to get data from songs. "${err}"`);
					return cb({ status: "error", message: err });
				}
				this.log("SUCCESS", "SONGS_GET_DATA", `Got data from songs successfully.`);
				return cb({ status: "success", message: "Successfully got data from songs.", data: response });
			}
		);
	}),

	/**
	 * Updates all songs
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param cb
	 */
	updateAll: isAdminRequired(async function updateAll(session, cb) {
		async.waterfall(
			[
				next => {
					SongsModule.runJob("UPDATE_ALL_SONGS", {}, this)
						.then(() => {
							next();
						})
						.catch(err => {
							next(err);
						});
				}
			],
			async err => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "SONGS_UPDATE_ALL", `Failed to update all songs. "${err}"`);
					return cb({ status: "error", message: err });
				}
				this.log("SUCCESS", "SONGS_UPDATE_ALL", `Updated all songs successfully.`);
				return cb({ status: "success", message: "Successfully updated all songs." });
			}
		);
	}),

	/**
	 * Gets a song from the Musare song id
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param {string} songId - the song id
	 * @param {Function} cb
	 */
	getSongFromSongId: isAdminRequired(function getSongFromSongId(session, songId, cb) {
		async.waterfall(
			[
				next => {
					SongsModule.runJob("GET_SONG", { songId }, this)
						.then(response => next(null, response.song))
						.catch(err => next(err));
				}
			],
			async (err, song) => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "SONGS_GET_SONG_FROM_MUSARE_ID", `Failed to get song ${songId}. "${err}"`);
					return cb({ status: "error", message: err });
				}
				this.log("SUCCESS", "SONGS_GET_SONG_FROM_MUSARE_ID", `Got song ${songId} successfully.`);
				return cb({ status: "success", data: { song } });
			}
		);
	}),

	/**
	 * Gets multiple songs from the Musare song ids
	 * At this time only used in EditSongs
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param {Array} songIds - the song ids
	 * @param {Function} cb
	 */
	getSongsFromSongIds: isAdminRequired(function getSongFromSongId(session, songIds, cb) {
		async.waterfall(
			[
				next => {
					SongsModule.runJob(
						"GET_SONGS",
						{
							songIds,
							properties: ["youtubeId", "title", "artists", "thumbnail", "duration", "verified", "_id"]
						},
						this
					)
						.then(response => next(null, response.songs))
						.catch(err => next(err));
				}
			],
			async (err, songs) => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "SONGS_GET_SONGS_FROM_MUSARE_IDS", `Failed to get songs. "${err}"`);
					return cb({ status: "error", message: err });
				}
				this.log("SUCCESS", "SONGS_GET_SONGS_FROM_MUSARE_IDS", `Got songs successfully.`);
				return cb({ status: "success", data: { songs } });
			}
		);
	}),

	/**
	 * Creates a song
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param {object} newSong - the song object
	 * @param {Function} cb
	 */
	create: isAdminRequired(async function create(session, newSong, cb) {
		async.waterfall(
			[
				next => {
					SongsModule.runJob("CREATE_SONG", { song: newSong, userId: session.userId }, this)
						.then(song => next(null, song))
						.catch(next);
				}
			],
			async (err, song) => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);

					this.log("ERROR", "SONGS_CREATE", `Failed to create song "${JSON.stringify(newSong)}". "${err}"`);

					return cb({ status: "error", message: err });
				}

				this.log("SUCCESS", "SONGS_CREATE", `Successfully created song "${song._id}".`);

				return cb({
					status: "success",
					message: "Song has been successfully created",
					data: { song }
				});
			}
		);
	}),

	/**
	 * Updates a song
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param {string} songId - the song id
	 * @param {object} song - the updated song object
	 * @param {Function} cb
	 */
	update: isAdminRequired(async function update(session, songId, song, cb) {
		const songModel = await DBModule.runJob("GET_MODEL", { modelName: "song" }, this);
		let existingSong = null;
		async.waterfall(
			[
				next => {
					songModel.findOne({ _id: songId }, next);
				},

				(_existingSong, next) => {
					existingSong = _existingSong;

					// Verify the song
					if (existingSong.verified === false && song.verified === true) {
						song.verifiedBy = session.userId;
						song.verifiedAt = Date.now();
					}
					// Unverify the song
					else if (existingSong.verified === true && song.verified === false) {
						song.verifiedBy = null;
						song.verifiedAt = null;
					}

					next();
				},

				next => {
					songModel.updateOne({ _id: songId }, song, { runValidators: true }, next);
				},

				(res, next) => {
					SongsModule.runJob("UPDATE_SONG", { songId }, this)
						.then(song => {
							existingSong.genres
								.concat(song.genres)
								.filter((value, index, self) => self.indexOf(value) === index)
								.forEach(genre => {
									PlaylistsModule.runJob("AUTOFILL_GENRE_PLAYLIST", {
										genre,
										createPlaylist: song.verified
									})
										.then(() => {})
										.catch(() => {});
								});

							next(null, song);
						})
						.catch(next);
				}
			],
			async (err, song) => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);

					this.log("ERROR", "SONGS_UPDATE", `Failed to update song "${songId}". "${err}"`);

					return cb({ status: "error", message: err });
				}

				this.log("SUCCESS", "SONGS_UPDATE", `Successfully updated song "${songId}".`);

				return cb({
					status: "success",
					message: "Song has been successfully updated",
					data: { song }
				});
			}
		);
	}),

	/**
	 * Removes a song
	 *
	 * @param session
	 * @param songId - the song id
	 * @param cb
	 */
	remove: isAdminRequired(async function remove(session, songId, cb) {
		const songModel = await DBModule.runJob("GET_MODEL", { modelName: "song" }, this);
		const stationModel = await DBModule.runJob("GET_MODEL", { modelName: "station" }, this);

		async.waterfall(
			[
				next => {
					songModel.findOne({ _id: songId }, next);
				},

				(song, next) => {
					PlaylistsModule.runJob("GET_PLAYLISTS_WITH_SONG", { songId }, this)
						.then(res => {
							async.eachLimit(
								res.playlists,
								1,
								(playlist, next) => {
									WSModule.runJob(
										"RUN_ACTION2",
										{
											session,
											namespace: "playlists",
											action: "removeSongFromPlaylist",
											args: [song.youtubeId, playlist._id]
										},
										this
									)
										.then(res => {
											if (res.status === "error") next(res.message);
											else next();
										})
										.catch(err => {
											next(err);
										});
								},
								err => {
									if (err) next(err);
									else next(null, song);
								}
							);
						})
						.catch(err => next(err));
				},

				(song, next) => {
					stationModel.find({ "queue._id": songId }, (err, stations) => {
						if (err) next(err);
						else {
							async.eachLimit(
								stations,
								1,
								(station, next) => {
									StationsModule.runJob(
										"REMOVE_FROM_QUEUE",
										{ stationId: station._id, youtubeId: song.youtubeId },
										this
									)
										.then(() => next())
										.catch(err => {
											if (
												err === "Station not found" ||
												err === "Song is not currently in the queue."
											)
												next();
											else next(err);
										});
								},
								err => {
									if (err) next(err);
									else next(null, song);
								}
							);
						}
					});
				},

				(song, next) => {
					stationModel.find({ "currentSong._id": songId }, (err, stations) => {
						if (err) next(err);
						else {
							async.eachLimit(
								stations,
								1,
								(station, next) => {
									StationsModule.runJob(
										"SKIP_STATION",
										{ stationId: station._id, natural: false },
										this
									)
										.then(() => {
											next();
										})
										.catch(err => {
											if (err.message === "Station not found.") next();
											else next(err);
										});
								},
								err => {
									if (err) next(err);
									else next(null, song);
								}
							);
						}
					});
				},

				(song, next) => {
					RatingsModule.runJob("REMOVE_RATINGS", { youtubeIds: song.youtubeId }, this)
						.then(() => next(null, song.youtubeId))
						.catch(next);
				},

				(youtubeId, next) => {
					YouTubeModule.youtubeVideoModel.findOne({ youtubeId }, (err, video) => {
						if (err) next(err);
						else next(null, video._id);
					});
				},

				(videoIds, next) => {
					YouTubeModule.runJob("REMOVE_VIDEOS", { videoIds }, this)
						.then(() => next())
						.catch(next);
				},

				next => {
					songModel.deleteOne({ _id: songId }, err => {
						if (err) next(err);
						else next();
					});
				},

				next => {
					CacheModule.runJob("HDEL", { table: "songs", key: songId }, this)
						.then(() => {
							next();
						})
						.catch(next);
				}
			],
			async err => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);

					this.log("ERROR", "SONGS_REMOVE", `Failed to remove song "${songId}". "${err}"`);

					return cb({ status: "error", message: err });
				}

				this.log("SUCCESS", "SONGS_REMOVE", `Successfully removed song "${songId}".`);

				CacheModule.runJob("PUB", {
					channel: "song.removed",
					value: { songId }
				});

				return cb({
					status: "success",
					message: "Song has been successfully removed"
				});
			}
		);
	}),

	/**
	 * Removes many songs
	 *
	 * @param session
	 * @param songIds - array of song ids
	 * @param cb
	 */
	removeMany: isAdminRequired(async function remove(session, songIds, cb) {
		const successful = [];
		const failed = [];

		async.waterfall(
			[
				next => {
					async.eachLimit(
						songIds,
						1,
						(songId, next) => {
							WSModule.runJob(
								"RUN_ACTION2",
								{
									session,
									namespace: "songs",
									action: "remove",
									args: [songId]
								},
								this
							)
								.then(res => {
									if (res.status === "error") failed.push(songId);
									else successful.push(songId);
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

					this.log("ERROR", "SONGS_REMOVE_MANY", `Failed to remove songs "${failed.join(", ")}". "${err}"`);

					return cb({ status: "error", message: err });
				}

				let message = "";
				if (successful.length === 1) message += `1 song has been successfully removed`;
				else message += `${successful.length} songs have been successfully removed`;
				if (failed.length > 0) {
					this.log("ERROR", "SONGS_REMOVE_MANY", `Failed to remove songs "${failed.join(", ")}". "${err}"`);
					if (failed.length === 1) message += `, failed to remove 1 song`;
					else message += `, failed to remove ${failed.length} songs`;
				}

				this.log("SUCCESS", "SONGS_REMOVE_MANY", `${message} "${successful.join(", ")}"`);

				return cb({
					status: "success",
					message
				});
			}
		);
	}),

	/**
	 * Searches through official songs
	 *
	 * @param {object} session - the session object automatically added by the websocket
	 * @param {string} query - the query
	 * @param {string} page - the page
	 * @param {Function} cb - gets called with the result
	 */
	searchOfficial: isLoginRequired(async function searchOfficial(session, query, page, cb) {
		async.waterfall(
			[
				next => {
					if ((!query && query !== "") || typeof query !== "string") next("Invalid query.");
					else next();
				},

				next => {
					SongsModule.runJob("SEARCH", {
						query,
						includeVerified: true,
						trimmed: true,
						page
					})
						.then(response => {
							next(null, response);
						})
						.catch(err => {
							next(err);
						});
				}
			],
			async (err, data) => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "SONGS_SEARCH_OFFICIAL", `Searching songs failed. "${err}"`);
					return cb({ status: "error", message: err });
				}
				this.log("SUCCESS", "SONGS_SEARCH_OFFICIAL", "Searching songs successful.");
				return cb({ status: "success", data });
			}
		);
	}),

	/**
	 * Verifies a song
	 *
	 * @param session
	 * @param songId - the song id
	 * @param cb
	 */
	verify: isAdminRequired(async function add(session, songId, cb) {
		const SongModel = await DBModule.runJob("GET_MODEL", { modelName: "song" }, this);
		async.waterfall(
			[
				next => {
					SongModel.findOne({ _id: songId }, next);
				},

				(song, next) => {
					if (!song) return next("This song is not in the database.");
					return next(null, song);
				},

				(song, next) => {
					const oldStatus = false;

					song.verifiedBy = session.userId;
					song.verifiedAt = Date.now();
					song.verified = true;

					song.save(err => next(err, song, oldStatus));
				},

				(song, oldStatus, next) => {
					song.genres.forEach(genre => {
						PlaylistsModule.runJob("AUTOFILL_GENRE_PLAYLIST", { genre, createPlaylist: true })
							.then(() => {})
							.catch(() => {});
					});

					SongsModule.runJob("UPDATE_SONG", { songId: song._id, oldStatus });
					next(null, song, oldStatus);
				}
			],
			async err => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "SONGS_VERIFY", `User "${session.userId}" failed to verify song. "${err}"`);
					return cb({ status: "error", message: err });
				}

				this.log("SUCCESS", "SONGS_VERIFY", `User "${session.userId}" successfully verified song "${songId}".`);

				return cb({
					status: "success",
					message: "Song has been verified successfully."
				});
			}
		);
		// TODO Check if video is in queue and Add the song to the appropriate stations
	}),

	/**
	 * Verify many songs
	 *
	 * @param session
	 * @param songIds - array of song ids
	 * @param cb
	 */
	verifyMany: isAdminRequired(async function verifyMany(session, songIds, cb) {
		const successful = [];
		const failed = [];

		async.waterfall(
			[
				next => {
					async.eachLimit(
						songIds,
						1,
						(songId, next) => {
							WSModule.runJob(
								"RUN_ACTION2",
								{
									session,
									namespace: "songs",
									action: "verify",
									args: [songId]
								},
								this
							)
								.then(res => {
									if (res.status === "error") failed.push(songId);
									else successful.push(songId);
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

					this.log("ERROR", "SONGS_VERIFY_MANY", `Failed to verify songs "${failed.join(", ")}". "${err}"`);

					return cb({ status: "error", message: err });
				}

				let message = "";
				if (successful.length === 1) message += `1 song has been successfully verified`;
				else message += `${successful.length} songs have been successfully verified`;
				if (failed.length > 0) {
					this.log("ERROR", "SONGS_VERIFY_MANY", `Failed to verify songs "${failed.join(", ")}". "${err}"`);
					if (failed.length === 1) message += `, failed to verify 1 song`;
					else message += `, failed to verify ${failed.length} songs`;
				}

				this.log("SUCCESS", "SONGS_VERIFY_MANY", `${message} "${successful.join(", ")}"`);

				return cb({
					status: "success",
					message
				});
			}
		);
	}),

	/**
	 * Un-verifies a song
	 *
	 * @param session
	 * @param songId - the song id
	 * @param cb
	 */
	unverify: isAdminRequired(async function add(session, songId, cb) {
		const SongModel = await DBModule.runJob("GET_MODEL", { modelName: "song" }, this);
		async.waterfall(
			[
				next => {
					SongModel.findOne({ _id: songId }, next);
				},

				(song, next) => {
					if (!song) return next("This song is not in the database.");
					return next(null, song);
				},

				(song, next) => {
					song.verified = false;
					song.verifiedBy = null;
					song.verifiedAt = null;
					song.save(err => {
						next(err, song);
					});
				},

				(song, next) => {
					song.genres.forEach(genre => {
						PlaylistsModule.runJob("AUTOFILL_GENRE_PLAYLIST", { genre, createPlaylist: false })
							.then(() => {})
							.catch(() => {});
					});

					SongsModule.runJob("UPDATE_SONG", { songId, oldStatus: true });

					next(null);
				}
			],
			async err => {
				if (err) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);

					this.log("ERROR", "SONGS_UNVERIFY", `User "${session.userId}" failed to verify song. "${err}"`);

					return cb({ status: "error", message: err });
				}

				this.log(
					"SUCCESS",
					"SONGS_UNVERIFY",
					`User "${session.userId}" successfully unverified song "${songId}".`
				);

				return cb({
					status: "success",
					message: "Song has been unverified successfully."
				});
			}
		);
		// TODO Check if video is in queue and Add the song to the appropriate stations
	}),

	/**
	 * Unverify many songs
	 *
	 * @param session
	 * @param songIds - array of song ids
	 * @param cb
	 */
	unverifyMany: isAdminRequired(async function unverifyMany(session, songIds, cb) {
		const successful = [];
		const failed = [];

		async.waterfall(
			[
				next => {
					async.eachLimit(
						songIds,
						1,
						(songId, next) => {
							WSModule.runJob(
								"RUN_ACTION2",
								{
									session,
									namespace: "songs",
									action: "unverify",
									args: [songId]
								},
								this
							)
								.then(res => {
									if (res.status === "error") failed.push(songId);
									else successful.push(songId);
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
						"SONGS_UNVERIFY_MANY",
						`Failed to unverify songs "${failed.join(", ")}". "${err}"`
					);

					return cb({ status: "error", message: err });
				}

				let message = "";
				if (successful.length === 1) message += `1 song has been successfully unverified`;
				else message += `${successful.length} songs have been successfully unverified`;
				if (failed.length > 0) {
					this.log(
						"ERROR",
						"SONGS_UNVERIFY_MANY",
						`Failed to unverify songs "${failed.join(", ")}". "${err}"`
					);
					if (failed.length === 1) message += `, failed to unverify 1 song`;
					else message += `, failed to unverify ${failed.length} songs`;
				}

				this.log("SUCCESS", "SONGS_UNVERIFY_MANY", `${message} "${successful.join(", ")}"`);

				return cb({
					status: "success",
					message
				});
			}
		);
	}),

	/**
	 * Gets a list of all genres
	 *
	 * @param session
	 * @param cb
	 */
	getGenres: isAdminRequired(function getGenres(session, cb) {
		async.waterfall(
			[
				next => {
					SongsModule.runJob("GET_GENRES", this)
						.then(res => {
							next(null, res.genres);
						})
						.catch(next);
				}
			],
			async (err, genres) => {
				if (err && err !== true) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "GET_GENRES", `User ${session.userId} failed to get genres. '${err}'`);
					cb({ status: "error", message: err });
				} else {
					this.log("SUCCESS", "GET_GENRES", `User ${session.userId} has successfully got the genres.`);
					cb({
						status: "success",
						message: "Successfully got genres.",
						data: {
							items: genres
						}
					});
				}
			}
		);
	}),

	/**
	 * Bulk update genres for selected songs
	 *
	 * @param session
	 * @param method Whether to add, remove or replace genres
	 * @param genres Array of genres to apply
	 * @param songIds Array of songIds to apply genres to
	 * @param cb
	 */
	editGenres: isAdminRequired(async function editGenres(session, method, genres, songIds, cb) {
		const songModel = await DBModule.runJob("GET_MODEL", { modelName: "song" }, this);
		async.waterfall(
			[
				next => {
					songModel.find({ _id: { $in: songIds } }, next);
				},

				(songs, next) => {
					const songsFound = songs.map(song => song._id);
					if (songsFound.length > 0) next(null, songsFound);
					else next("None of the specified songs were found.");
				},

				(songsFound, next) => {
					const query = {};
					if (method === "add") {
						query.$addToSet = { genres: { $each: genres } };
					} else if (method === "remove") {
						query.$pullAll = { genres };
					} else if (method === "replace") {
						query.$set = { genres };
					} else {
						next("Invalid method.");
						return;
					}

					songModel.updateMany({ _id: { $in: songsFound } }, query, { runValidators: true }, err => {
						if (err) {
							next(err);
							return;
						}
						SongsModule.runJob("UPDATE_SONGS", { songIds: songsFound });
						next();
					});
				}
			],
			async err => {
				if (err && err !== true) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "EDIT_GENRES", `User ${session.userId} failed to edit genres. '${err}'`);
					cb({ status: "error", message: err });
				} else {
					this.log("SUCCESS", "EDIT_GENRES", `User ${session.userId} has successfully edited genres.`);
					cb({
						status: "success",
						message: "Successfully edited genres."
					});
				}
			}
		);
	}),

	/**
	 * Gets a list of all artists
	 *
	 * @param session
	 * @param cb
	 */
	getArtists: isAdminRequired(function getArtists(session, cb) {
		async.waterfall(
			[
				next => {
					SongsModule.runJob("GET_ARTISTS", this)
						.then(res => {
							next(null, res.artists);
						})
						.catch(next);
				}
			],
			async (err, artists) => {
				if (err && err !== true) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "GET_ARTISTS", `User ${session.userId} failed to get artists. '${err}'`);
					cb({ status: "error", message: err });
				} else {
					this.log("SUCCESS", "GET_ARTISTS", `User ${session.userId} has successfully got the artists.`);
					cb({
						status: "success",
						message: "Successfully got artists.",
						data: {
							items: artists
						}
					});
				}
			}
		);
	}),

	/**
	 * Bulk update artists for selected songs
	 *
	 * @param session
	 * @param method Whether to add, remove or replace artists
	 * @param artists Array of artists to apply
	 * @param songIds Array of songIds to apply artists to
	 * @param cb
	 */
	editArtists: isAdminRequired(async function editArtists(session, method, artists, songIds, cb) {
		const songModel = await DBModule.runJob("GET_MODEL", { modelName: "song" }, this);
		async.waterfall(
			[
				next => {
					songModel.find({ _id: { $in: songIds } }, next);
				},

				(songs, next) => {
					const songsFound = songs.map(song => song._id);
					if (songsFound.length > 0) next(null, songsFound);
					else next("None of the specified songs were found.");
				},

				(songsFound, next) => {
					const query = {};
					if (method === "add") {
						query.$addToSet = { artists: { $each: artists } };
					} else if (method === "remove") {
						query.$pullAll = { artists };
					} else if (method === "replace") {
						query.$set = { artists };
					} else {
						next("Invalid method.");
						return;
					}

					songModel.updateMany({ _id: { $in: songsFound } }, query, { runValidators: true }, err => {
						if (err) {
							next(err);
							return;
						}
						SongsModule.runJob("UPDATE_SONGS", { songIds: songsFound });
						next();
					});
				}
			],
			async err => {
				if (err && err !== true) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "EDIT_ARTISTS", `User ${session.userId} failed to edit artists. '${err}'`);
					cb({ status: "error", message: err });
				} else {
					this.log("SUCCESS", "EDIT_ARTISTS", `User ${session.userId} has successfully edited artists.`);
					cb({
						status: "success",
						message: "Successfully edited artists."
					});
				}
			}
		);
	}),

	/**
	 * Gets a list of all tags
	 *
	 * @param session
	 * @param cb
	 */
	getTags: isAdminRequired(function getTags(session, cb) {
		async.waterfall(
			[
				next => {
					SongsModule.runJob("GET_TAGS", this)
						.then(res => {
							next(null, res.tags);
						})
						.catch(next);
				}
			],
			async (err, tags) => {
				if (err && err !== true) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "GET_TAGS", `User ${session.userId} failed to get tags. '${err}'`);
					cb({ status: "error", message: err });
				} else {
					this.log("SUCCESS", "GET_TAGS", `User ${session.userId} has successfully got the tags.`);
					cb({
						status: "success",
						message: "Successfully got tags.",
						data: {
							items: tags
						}
					});
				}
			}
		);
	}),

	/**
	 * Bulk update tags for selected songs
	 *
	 * @param session
	 * @param method Whether to add, remove or replace tags
	 * @param tags Array of tags to apply
	 * @param songIds Array of songIds to apply tags to
	 * @param cb
	 */
	editTags: isAdminRequired(async function editTags(session, method, tags, songIds, cb) {
		const songModel = await DBModule.runJob("GET_MODEL", { modelName: "song" }, this);
		async.waterfall(
			[
				next => {
					songModel.find({ _id: { $in: songIds } }, next);
				},

				(songs, next) => {
					const songsFound = songs.map(song => song._id);
					if (songsFound.length > 0) next(null, songsFound);
					else next("None of the specified songs were found.");
				},

				(songsFound, next) => {
					const query = {};
					if (method === "add") {
						query.$addToSet = { tags: { $each: tags } };
					} else if (method === "remove") {
						query.$pullAll = { tags };
					} else if (method === "replace") {
						query.$set = { tags };
					} else {
						next("Invalid method.");
						return;
					}

					songModel.updateMany({ _id: { $in: songsFound } }, query, { runValidators: true }, err => {
						if (err) {
							next(err);
							return;
						}
						SongsModule.runJob("UPDATE_SONGS", { songIds: songsFound });
						next();
					});
				}
			],
			async err => {
				if (err && err !== true) {
					err = await UtilsModule.runJob("GET_ERROR", { error: err }, this);
					this.log("ERROR", "EDIT_TAGS", `User ${session.userId} failed to edit tags. '${err}'`);
					cb({ status: "error", message: err });
				} else {
					this.log("SUCCESS", "EDIT_TAGS", `User ${session.userId} has successfully edited tags.`);
					cb({
						status: "success",
						message: "Successfully edited tags."
					});
				}
			}
		);
	})
};
