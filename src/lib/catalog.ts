// Free public-domain books bundled with the app (served from /public/books).
// Source: Project Gutenberg. US public domain; check local law for other countries.
export interface CatalogBook {
  id: string;
  title: string;
  author: string;
  file: string; // path under /public
  source: string;
}

export const CATALOG: CatalogBook[] = [
  { id: "pg1342", title: "Pride and Prejudice", author: "Jane Austen", file: "/books/pg1342.epub", source: "gutenberg.org/ebooks/1342" },
  { id: "pg84", title: "Frankenstein", author: "Mary Shelley", file: "/books/pg84.epub", source: "gutenberg.org/ebooks/84" },
  { id: "pg11", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", file: "/books/pg11.epub", source: "gutenberg.org/ebooks/11" },
  { id: "pg1661", title: "The Adventures of Sherlock Holmes", author: "Arthur Conan Doyle", file: "/books/pg1661.epub", source: "gutenberg.org/ebooks/1661" },
  { id: "pg345", title: "Dracula", author: "Bram Stoker", file: "/books/pg345.epub", source: "gutenberg.org/ebooks/345" },
  { id: "pg2701", title: "Moby-Dick", author: "Herman Melville", file: "/books/pg2701.epub", source: "gutenberg.org/ebooks/2701" },
  { id: "pg98", title: "A Tale of Two Cities", author: "Charles Dickens", file: "/books/pg98.epub", source: "gutenberg.org/ebooks/98" },
  { id: "pg5200", title: "Metamorphosis", author: "Franz Kafka", file: "/books/pg5200.epub", source: "gutenberg.org/ebooks/5200" },
];
