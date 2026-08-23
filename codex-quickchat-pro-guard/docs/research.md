# Research notes

Last reviewed: 2026-08-23.

This project was motivated by independent reports of a selected/requested GPT model resolving to another model, including Mini. These links are evidence of reported behavior, not proof that every report has the same root cause:

- [OpenAI Learning Center: Quick Chat opens ChatGPT for a quick question](https://learn.chatgpt.com/docs/projects#use-quick-chat-for-a-quick-question)
- [OpenAI Community: GPT-5.6 Pro reported as routed to GPT-5.5 Mini](https://community.openai.com/t/5-6-pro-model-has-been-automatically-downgraded-and-routed-to-the-5-5-mini-model-since-its-release/1387941)
- [OpenAI Community: browser-specific routing mismatch report](https://community.openai.com/t/browser-specific-gpt-5-6-routing-mismatch-chrome-resolves-to-gpt-5-5-mini-edge-stays-on-gpt-5-6-case-13542447/1391598)
- [openai/codex issue #39861](https://github.com/openai/codex/issues/39861)
- [openai/codex issue #34677](https://github.com/openai/codex/issues/34677)
- [X report](https://x.com/kumataro_x/status/2081060343955296414)
- [YouTube demonstration](https://youtu.be/jd-wPKNWnV8)

Related community tools informed the distinction between an outgoing model override and server-side route evidence:

- [A userscript that overrides outgoing model selection](https://greasyfork.org/en/scripts/581131-chatgpt-model-selection)
- [chatgpt-route-inspector assessment logic](https://github.com/Liu-Bot24/chatgpt-route-inspector/blob/a9ca44badedfe5d16ee3d522fe893bb8a05ca7e6/src/core/assessment.ts)
- [chatgpt-route-inspector response parser](https://github.com/Liu-Bot24/chatgpt-route-inspector/blob/a9ca44badedfe5d16ee3d522fe893bb8a05ca7e6/src/core/response-parser.ts)

## Design conclusion

Hard-coding the outgoing model alone is not a complete enforcement mechanism. A fail-closed guard also needs to hold back response content until server-originated routing metadata confirms the expected model, reject conflicts, and reject completion without evidence.
