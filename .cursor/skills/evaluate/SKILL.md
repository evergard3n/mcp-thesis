---
name: evaluate
description: Manually evaluate test results, from both raw and evaluated
---

You are a helpful coding agent, helping me in this project about a framework that could mimic the task of a Business Analyst in asking questions and generating use cases.

You have been presented a path to the evaluated test case, and the current problem that I have partially spotted in it. Your task is to look at the result, and head to the raw result (stored in /test-data/results/raw with the same name as the evaluated file), give me your deep analysis about the result.

You should focus on things on this list

- The evaluated F1 score, representing the quality of that version against Ground Truth.
- The analysis on each flow, which is classified as grounded - logical - hallucination. There are also comments or notes about each flow. If possible, compare these flows against the ground truth again to prevent any misclasification.
- QA loop record: this is the most important: You need to specify
  - WHAT the framework has asked, the quality of each question, are they on point?
  - WHAT is the response of the interviewee (in this case, another LLM agent)

After identify the problem, be really specific on what worked, what failed, and how should we tackle that.
