import type { Candidate } from './types';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

const QUESTION =
  'Is the following text, shown on the page described in state, personal, private, or account-identifying information that the page owner would want hidden while screen sharing or streaming?';

const CRITERIA_TRUE =
  "The text IS an actual value: a real person's name or username, an email address, a company/organization/team/workspace name, an account/organization/project/customer ID, an API key, token, or secret, a billing amount, credit balance, invoice total, a phone number, or a physical address.";

const CRITERIA_FALSE =
  "The text is generic UI text: navigation labels, buttons, headings, menu items, product/feature names, documentation, placeholder text, dates, counts, or a field label/caption that merely names a kind of data (e.g. 'API keys', 'Email address', 'Organization ID', 'Credit balance') without containing the actual value.";

export async function classifyCandidates(
  apiKey: string,
  pageTitle: string,
  pageUrl: string,
  candidates: Candidate[],
): Promise<Record<string, number>> {
  const body = {
    model: 'jev-latest',
    state: { page_title: pageTitle, page_url: pageUrl },
    questions: Object.fromEntries(
      candidates.map((c) => [
        c.id,
        {
          type: 'noul',
          instructions: {
            question: QUESTION,
            text: c.text.trim(),
            surrounding_text: c.context,
          },
          criteria: { true: CRITERIA_TRUE, false: CRITERIA_FALSE },
        },
      ]),
    ),
  };

  const res = await post(apiKey, body);
  const json = (await res.json()) as {
    answers?: Record<string, { noul?: number }>;
  };
  const out: Record<string, number> = {};
  for (const c of candidates) {
    const v = json.answers?.[c.id]?.noul;
    if (typeof v === 'number') out[c.id] = v;
  }
  return out;
}

async function post(apiKey: string, body: unknown, retried = false): Promise<Response> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if ((res.status === 429 || res.status === 529) && !retried) {
      await new Promise((r) => setTimeout(r, 800));
      return post(apiKey, body, true);
    }
    const text = await res.text();
    throw new Error(`typesafe ${res.status}: ${text}`);
  }
  return res;
}
