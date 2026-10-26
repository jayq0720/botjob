export const SUPPORTED_BOARDS = ["zhilian", "liepin"] as const;
export type BoardId = (typeof SUPPORTED_BOARDS)[number];

export type SearchCriteria = {
  keywords: string[];
  cities: string[];
  titles: string[];
};

export type BoardSearchPack = {
  board: BoardId;
  boardName: string;
  searchUrl: string;
  query: string;
  cityHint: string;
  notes: string;
};
