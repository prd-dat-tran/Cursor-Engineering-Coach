---
title: "Skill Finder"
weight: 20
description: "Discover repeated prompts and matching community Cursor rules"
---

# Skill Finder

The Skill Finder analyzes your prompt history to identify repeated patterns that waste time and matches them against a community-maintained Cursor rules and skills catalog.

![Skill Finder](/screenshots/screen-skill-finder.png)

## Custom Skill Opportunities

Cursor Engineering Coach groups similar prompts across your sessions. When the same type of request appears multiple times in different sessions, it surfaces as a **Custom Skill Opportunity**. For example, if you repeatedly ask to "package the extension", the Skill Finder detects this pattern and suggests creating a reusable Cursor rule or skill for it.

Each opportunity shows:

- The number of repetitions and sessions
- Example prompts that triggered the detection
- An **Install Skill** button that helps you create a reusable rule file under `.cursor/rules/`

## Community Cursor Rules and Skills

Below the custom opportunities, Cursor Engineering Coach queries the community catalog and displays matching entries. These are curated Cursor rules and skills maintained in the open-source community directory.

Each community match shows:

- **Rule name** and category (e.g., FRONTEND, TESTING, OTHER)
- **Description** of what the rule or skill does
- **Why it matches** your usage pattern
- An **Install** button to add it to your workspace under `.cursor/rules/`

## Configuration

You can select the workspace and look-back period (1 month, 3 months, 6 months) to control the scope of the analysis. Click **Analyze** to refresh the findings.
