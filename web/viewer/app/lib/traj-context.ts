import { createContext, useContext } from "react";

/** Where the steps being rendered live, for blob fetches and fork links. */
export interface TrajContextValue {
  identityId: string;
  trajId: string;
}

export const TrajContext = createContext<TrajContextValue | null>(null);

export function useTrajContext(): TrajContextValue | null {
  return useContext(TrajContext);
}
