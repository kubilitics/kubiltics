# Chat-Quality Judge Rubric

The judge scores each bench answer across four axes, 1–5, where 5 is best.

## 1. Factual correctness (1–5)

- **5** — All claims are verifiable from the tool results. No fabrication.
- **4** — Minor factual slip that doesn't change the verdict.
- **3** — One meaningful claim is unsupported or slightly wrong.
- **2** — Multiple unsupported claims; the answer would mislead a reader.
- **1** — Core claim is false. Fabricated names, fabricated numbers, or invented resources.

## 2. Completeness (1–5)

- **5** — Every sub-question is answered; no obvious follow-up needed.
- **4** — All main questions answered; one minor aspect glossed over.
- **3** — Partial answer; a reasonable operator would still need to ask for more.
- **2** — Only the easiest part of the question answered.
- **1** — Doesn't actually answer the question.

## 3. Clarity (1–5)

- **5** — Precise sentences, right level of jargon, no filler. A tired SRE at 3am can parse it quickly.
- **4** — Mostly clear; one awkward section.
- **3** — Correct but overlong, hedged, or poorly organized.
- **2** — Hard to follow; requires re-reading to extract the answer.
- **1** — Word salad, hallucinated structure, or bullet-point dump with no narrative.

## 4. Tool-use appropriateness (1–5)

- **5** — Called the right tool(s), no redundant calls, used parameters well.
- **4** — Right tools but one unnecessary call or sub-optimal parameter.
- **3** — Right family of tool but wrong specific choice, OR needed one more call.
- **2** — Wrong tool selected; the answer had to paper over the mismatch.
- **1** — Called tools that are actively inappropriate, or called none when one was needed.

## Output format (strict)

The judge MUST emit a single JSON object with exactly these fields:

```json
{
  "factual": 1-5,
  "completeness": 1-5,
  "clarity": 1-5,
  "tool_use": 1-5,
  "critique": "<one-sentence summary>"
}
```

No Markdown code fences, no preamble, no trailing text. The bench runner
parses the entire response as JSON.
