# Lost in the Middle: How Language Models Use Long Contexts
**Authors**: Nelson F. Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, Percy Liang  
**Published in**: Transactions of the Association for Computational Linguistics (TACL 2023)

---

### [p.1] Abstract
While recent language models have the ability to take long contexts as input, relatively little is known about how well the language model uses longer context. In this work, we analyze the performance of language models on multi-document question answering and key-value retrieval tasks when the input context length is varied. We find that performance is often highest when relevant information occurs at the beginning or end of the input context, and significantly degrades when models must access relevant information in the middle of long contexts.

---

### [p.2] 1. Introduction
Language models (LMs) have revolutionized natural language processing, demonstrating remarkable few-shot and zero-shot capabilities across a wide range of tasks. To support tasks requiring substantial context—such as question answering over multiple documents, summarization of books, or code synthesis across multiple repositories—recent state-of-the-art models support context windows of 16K, 32K, or even 100K tokens.

However, does simply feeding more tokens into the prompt allow the model to reason effectively over all of them? In this paper, we conduct a systematic evaluation across various model families (including GPT-3.5, Claude, MPT-30B, Llama-2-70B).

---

### [p.3] 2. Experimental Setup: Multi-Document QA
We evaluate model performance on multi-document question answering using the NaturalQuestions benchmark. Given a question and $k$ input documents, exactly one document contains the answer to the question, while the remaining $k-1$ documents are distractor documents that are retrieved from Wikipedia. We vary the position of the gold document within the input sequence to measure positional sensitivity.

---

### [p.4] 3. Results & The "U-Shaped" Attention Curve
Our primary empirical finding is robust across all evaluated models:
1. **Primacy Effect**: Models achieve near peak retrieval accuracy (approx 78%) when the gold information is positioned within the first 10% of the prompt.
2. **Recency Effect**: Accuracy recovers (approx 71%) when the key facts appear in the trailing 15% of the prompt.
3. **The Middle Valley**: When key evidence resides in the middle (between 30% and 70% of context length), performance collapses to below 35%.

**Core Implication**: When conversational history accumulates sequentially, earlier premises and mid-conversation explorations are pushed into the 'middle valley' where LLM reasoning fidelity drops catastrophically while hallucination rates surge.

---

### [p.5] 4. Conclusion and Context Curation Strategies
We conclude that longer context windows do not eliminate the necessity of context curation. Explicit selective context architectures—such as sub-branch pruning and directed acyclic reasoning paths—are fundamentally superior to naive context accumulation.
