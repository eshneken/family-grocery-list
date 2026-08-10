import type { AutocompleteCandidate } from "./suggestions";

export const AUTOCOMPLETE_RESULT_LIMIT = 6;

export type IndexedAutocompleteCandidate = AutocompleteCandidate & {
  normalizedTerms: Array<{ words: string[]; full: string; canonical: boolean }>;
};

/** Produces case-insensitive Unicode words without changing the value shown to the user. */
export function normalizeAutocompleteWords(value: string) {
  return (value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Precomputes the tiny in-memory search index once when the Quick Add component renders. */
export function indexAutocompleteCandidates(candidates: AutocompleteCandidate[]): IndexedAutocompleteCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    normalizedTerms: candidate.matchTerms.map((term, index) => {
      const words = normalizeAutocompleteWords(term);
      return { words, full: words.join(" "), canonical: index === 0 };
    })
  }));
}

function wordsMatchInOrder(queryWords: string[], candidateWords: string[]) {
  let nextCandidateIndex = 0;
  return queryWords.every((queryWord) => {
    const matchIndex = candidateWords.findIndex(
      (candidateWord, index) => index >= nextCandidateIndex && candidateWord.startsWith(queryWord)
    );
    if (matchIndex < 0) return false;
    nextCandidateIndex = matchIndex + 1;
    return true;
  });
}

function matchQuality(candidate: IndexedAutocompleteCandidate, queryWords: string[]) {
  const query = queryWords.join(" ");
  let best = Number.POSITIVE_INFINITY;
  candidate.normalizedTerms.forEach((term) => {
    if (!wordsMatchInOrder(queryWords, term.words)) return;
    const fullPrefix = term.full.startsWith(query);
    const quality = term.canonical ? (fullPrefix ? 0 : 1) : fullPrefix ? 2 : 3;
    best = Math.min(best, quality);
  });
  return best;
}

/** Returns at most six local matches, retaining server rank for equal-quality results. */
export function getAutocompleteMatches(
  candidates: IndexedAutocompleteCandidate[],
  query: string,
  limit = AUTOCOMPLETE_RESULT_LIMIT
) {
  const queryWords = normalizeAutocompleteWords(query);
  if (queryWords.length === 0) return [];

  return candidates
    .map((candidate, serverRank) => ({ candidate, serverRank, quality: matchQuality(candidate, queryWords) }))
    .filter((match) => Number.isFinite(match.quality))
    .sort((a, b) => a.quality - b.quality || a.serverRank - b.serverRank)
    .slice(0, limit)
    .map((match) => match.candidate);
}
