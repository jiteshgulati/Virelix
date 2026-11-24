# analysis/ — reserved for Week 3

Week 3 adds **aggregate query logging** and its analysis:

1. The search API appends one anonymised event per submitted query (normalised terms, mode,
   result count, timestamp) to `data/analytics/queries.jsonl`. This is separate from members'
   private search history, which is never used for analytics.
2. `analysis/query_analysis.py` will load the log with **pandas**, compute top searched terms,
   document frequency and rank–frequency data.
3. **matplotlib** charts (top terms bar chart, Zipf log–log plot) are written to
   `data/analytics/charts/` and shown on the Admin → Search analytics page.

The analysis dependencies (pandas, matplotlib) will be declared in `requirements-analysis.txt` when that work starts. They aren't needed to run Week 1.
