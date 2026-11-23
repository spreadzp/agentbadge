// EPIC-262 (SLICE-262-10/11): shared Layout wrapper for /intel pages.
import { Layout } from "../../../views/chrome/layout";

export const intelPage = (content: string, title: string, path: string) =>
  Layout(content, title, { title, description: title, path }, undefined, true);
