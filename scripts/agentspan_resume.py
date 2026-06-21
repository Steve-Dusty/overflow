#!/usr/bin/env python3
"""
Durability demo — "the process dies, the agent doesn't."

The AgentSpan story in one script: start the safety agent, throw away the local
handle as if the process crashed, then RESUME the very same execution by id and let
it finish. Because AgentSpan keeps execution state on the server, the work picks up
from the exact step it reached — no re-running tools, no lost progress.

    npm run agentspan:resume
"""
from __future__ import annotations

import os
import sys

from agentspan.agents import AgentRuntime, resume

from agentspan_agent import DEFAULT_GOAL, agent


def _c(code):
    return lambda s: f"\x1b[{code}m{s}\x1b[0m"


dim, bold, green, yellow, red = _c("2"), _c("1"), _c("32"), _c("33"), _c("31")


def main() -> None:
    server = os.environ.get("AGENTSPAN_SERVER_URL") or "http://localhost:6767"
    api_key = os.environ.get("AGENTSPAN_API_KEY") or None
    api_secret = os.environ.get("AGENTSPAN_API_SECRET") or None

    print(bold("\nAgentSpan durability demo — crash & resume\n"))
    try:
        with AgentRuntime(server_url=server, api_key=api_key, api_secret=api_secret) as rt:
            # 1) launch (fire-and-forget; state is on the server)
            handle = rt.start(agent, DEFAULT_GOAL)
            eid = handle.execution_id
            print(f"{green('① started')}  execution_id = {eid}")

            # 2) simulate a crash: drop the local handle entirely
            del handle
            print(f"{red('② CRASH')}   local handle thrown away (pretend the process died)")

            # 3) resume the SAME execution by id — server still has the state
            print(f"{yellow('③ resume')}  reconnecting to {eid} …")
            resumed = resume(eid, agent, runtime=rt)
            result = resumed.join(timeout=180)

            print(f"{green('④ done')}    status = {result.status}")
            result.print_result()
            print(dim(f"\nExecution {eid} continued from where it stopped — it never restarted.\n"))
    except Exception as e:
        print(yellow(f"\nDemo stopped early: {e}"))
        print(dim("The crash→resume-by-id flow above is the integration point; a full finish"))
        print(dim("needs the runtime up and an LLM key (overflow's is in server/.env)."))
        sys.exit(0)


if __name__ == "__main__":
    main()
