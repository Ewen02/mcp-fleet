# Privacy

The MCP servers of this repository (currently: paie-fr) are stateless calculators. These rules are enforced by the shared kit, so they hold for every server.

- **What is sent**: the parameters of a calculation (for paie-fr: gross salary, period, executive status, household situation…), chosen by the AI client from your conversation.
- **What is stored**: nothing. There is no database and no account. Calculations are made in memory and discarded after the response.
- **What is logged**: technical metadata only: time, HTTP method, path, status, duration, request id and, for tool calls, the tool name, outcome and duration. Tool arguments and request bodies are never logged. Client IP addresses are used in memory for rate limiting and are not written to logs.
- **Log retention**: application logs are rotated (3 files of 10 MB). The reverse proxy keeps no access log for these servers, and removes client IPs and headers from its error logs.
- **Third parties**: none. Calculations run locally with open-source engines; no data is sent to URSSAF or any other service.

Amounts are estimates for information purposes only. They are not tax or legal advice. This project is not affiliated with URSSAF or beta.gouv.fr.
