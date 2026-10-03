import { createContext } from "react";

// Loaded Banking data ({ lists: { collections, expenses, transfers }, students });
// the popover reads it first and only fetches one entry when it is missing.
export const BookEntryContext = createContext({ lists: {}, students: [] });
