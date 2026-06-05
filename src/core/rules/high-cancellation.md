---
id: high-cancellation
name: Excessive Cancellations
group: session-hygiene
severity: medium
scope: requests
version: 1
tags: [session, cancellation, waste]
thresholds:
  maxCancelRate: 0.15
  highSeverityRate: 0.3
---

# Description
Detects a high rate of cancelled requests. Every cancelled request still consumes a request/credit, so a high cancel rate is wasted spend and usually signals unclear prompting.

# When Triggered
{{count}} of {{total}} requests cancelled ({{pct}}). Each cancelled request is wasted spend — on request-based billing it still burns a full request, and on usage-based billing it still consumes tokens.

# How to Improve
Write clearer, more specific prompts and give the agent enough context up front so it lands the task in one pass. Wait for responses instead of cancelling prematurely.

# Examples
"{{message}}..."

# Detection Logic
```detect
scan: requests
match: isCanceled == true
aggregate: ratio
check: ratio > thresholds.maxCancelRate
examples: "{{messageText | clip:80}}"
```
