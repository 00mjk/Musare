/* eslint-disable import/no-cycle */
import { createStore } from "vuex";

import modalVisibility from "./modules/modalVisibility";

const emptyModule = {
	namespaced: true
};

export default createStore({
	modules: {
		modalVisibility,
		modals: {
			namespaced: true,
			modules: {
				editSong: emptyModule,
				editSongs: emptyModule,
				importAlbum: emptyModule,
				editPlaylist: emptyModule,
				manageStation: emptyModule,
				whatIsNew: emptyModule,
				createStation: emptyModule,
				editNews: emptyModule,
				viewApiRequest: emptyModule,
				viewPunishment: emptyModule,
				report: emptyModule,
				viewReport: emptyModule,
				confirm: emptyModule,
				bulkActions: emptyModule,
				viewYoutubeVideo: emptyModule,
				removeAccount: emptyModule
			}
		}
	},
	strict: false
});
