import { defineStore } from "pinia";
import { Song } from "@/types/song";

export const useReportStore = ({ modalUuid }: { modalUuid: string }) =>
	defineStore(`report-${modalUuid}`, {
		state: () => ({
			song: <Song>{}
		}),
		actions: {
			init({ song }) {
				this.song = song;
			}
		}
	})();
