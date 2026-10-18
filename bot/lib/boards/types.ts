export type BoardId = "zhilian" | "liepin" | "job51";

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
