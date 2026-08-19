export interface ProjectQuery { readonly projectId: string; }
export interface EpisodeQuery extends ProjectQuery { readonly episodeId: string; }
export interface ReviewRunQuery extends ProjectQuery { readonly reviewRunId: string; }
export interface SnapshotQuery extends ProjectQuery { readonly snapshotId: string; }
