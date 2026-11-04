#!/bin/bash
# wait.sh SID: block until the user's next line on the panel (not chat echoes), print it, exit.
# Run it with run_in_background: its exit re-invokes the session, which a Monitor event does not.
f=~/.claude/see/sessions/$1/talk.jsonl
n=$(wc -l < "$f")
while true; do
  m=$(tail -n +$((n+1)) "$f" | grep -E '"who": ?"you"' | grep -Ev '"kind": ?"chat"' | head -1)
  [ -n "$m" ] && { echo "$m"; exit 0; }
  sleep 1
done
