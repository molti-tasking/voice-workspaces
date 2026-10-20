# Cognitive offloading to AI and to external memory: what to offload ("holding") versus what to keep ("thinking")

Notes compiled 13 Oct 2026 for framing the Souffleur formative field study (voice thinking partner used on car commutes; IMWUT / CHI-adjacent).

**Status tags used on every entry:**
- **[PR]** peer-reviewed.
- **[Preprint]** not peer-reviewed (arXiv or SSRN).
- **[V]** title, venue and finding were checked in this session through search or fetch.
- **[V-sec]** the finding was checked only through a secondary summary (press release, PsyPost, aggregator). The primary paper was not read.
- **[DK]** canonical paper cited from domain knowledge. Its existence is certain, but the DOI or page details were not re-checked in this session. Verify these before camera-ready.

Format per entry: **Authors (year). Title. Venue. Link. [tags]** — finding → *framing implication for Souffleur*.

---

## 1. Foundational accounts of cognitive offloading: what do they predict about when offloading helps or harms?

### Takeaway
Classic work treats offloading as a metacognitively driven, value-based choice. Offloading reliably improves immediate performance and frees internal capacity, especially for **delayed intentions** and information that would otherwise interfere. The costs fall on **later unaided memory and learning**, appear when the store is unreliable or removed, and include **inflated sense of one's own knowledge**. The theories predict that offloading "what you hold" (intentions, open loops) is the most defensible kind. They also show it is **not free**: people over-offload, and offloading intentions can reduce learning of the intentions themselves.

### Cited Findings

**Core theory**
- **Risko, E. F. & Gilbert, S. J. (2016). Cognitive offloading. *Trends in Cognitive Sciences* 20(9):676–688.** https://doi.org/10.1016/j.tics.2016.07.002 **[PR][DK]**
  - Defines offloading as using physical action to change the information-processing demands of a task so as to reduce cognitive demand. Proposes a metacognitive model: people offload on the basis of their beliefs about their internal abilities and the effort involved, not on the basis of optimal performance. (Gilbert's later work, cited below, paraphrases this as "using physical actions in the world to limit costly internal storage and processing".)
  - *Gives a vocabulary for treating speaking a task aloud on the commute as an offloading action. It predicts that how much each participant offloads will depend on their confidence in their own memory, not only on how useful the system is.*
- **Gilbert, S. J. (2024). Cognitive offloading is value-based decision making: Modelling cognitive effort and the expected value of memory. *Cognition* 247:105783.** https://doi.org/10.1016/j.cognition.2024.105783 **[PR][V citation via Chiappe et al. 2025]**
  - Computational modelling frames the choice between internal memory and a reminder as weighing effort costs against the expected value of remembering.
  - *Frames Souffleur's "relief" as lowering the cost side of that choice: capture becomes nearly free while driving. Expect offloading to rise sharply when capture costs are low.*
- **Clark, A. & Chalmers, D. (1998). The extended mind. *Analysis* 58(1):7–19.** https://doi.org/10.1093/analys/58.1.7 **[PR][DK]**
  - Otto's notebook: an external store counts as part of the cognitive system when it is reliably available, easily accessed and automatically endorsed (the "trust and glue" conditions).
  - *The board only "holds" open loops for someone if it meets those conditions. This gives a theoretical reason to measure trust and how often people come back to the board, not just how much they capture.*
- **Clark, A. (2025). Extending minds with generative AI. *Nature Communications* 16:4627.** https://doi.org/10.1038/s41467-025-59906-9 (record: https://ideas.repec.org/a/nat/natcom/v16y2025i1d10.1038_s41467-025-59906-9.html) **[PR][V]**
  - Argues that GenAI is a new layer in an already hybrid, distributed cognitive system. Whether it helps or harms depends on how it is integrated. Calls for "extended cognitive hygiene" as a new skill set.
  - *The most prominent current theoretical ally for a "design the integration, not the abstinence" position. Souffleur's holding/thinking split can be presented as a concrete form of extended cognitive hygiene.*
- **Wegner, D. M. (1987). Transactive memory: A contemporary analysis of the group mind. In *Theories of Group Behavior*, Springer.** https://doi.org/10.1007/978-1-4612-4634-3_9 **[PR chapter][DK]**
  - People in a group divide memory work and remember *who knows what* rather than the content itself.
  - *An AI partner can be framed as a transactive-memory partner that "knows" the user's open loops. The user then needs only to know that the system has them and where to find them.*

**Internet / "Google effect" line**
- **Sparrow, B., Liu, J. & Wegner, D. M. (2011). Google effects on memory: Cognitive consequences of having information at our fingertips. *Science* 333:776–778.** https://doi.org/10.1126/science.1207745 **[PR][V]**
  - When people expect future access to information, they recall the information less and recall *where* to find it better.
  - *A classic citation for "people remember the pointer, not the content". It must be paired with the replication record below.*
- **Camerer, C. F. et al. (2018). Evaluating the replicability of social science experiments in Nature and Science between 2010 and 2015. *Nature Human Behaviour*.** https://doi.org/10.1038/s41562-018-0399-z; replication record: https://forrt.org/flora-replication-atlas/doi/10.1126/science.1207745/ **[PR][V]**
  - The Sparrow et al. effect **failed to replicate**: p = .26 in the first round of data collection and p = .45 pooled.
  - *Do not lean on the Google effect as settled. Cite it as a historically influential idea whose core lab effect did not replicate.*
- **Gong, C. & Yang, Y. (2024). Google effects on memory: a meta-analytical review of the media effects of intensive Internet search behavior. *Frontiers in Public Health*.** https://doi.org/10.3389/fpubh.2024.1332030 **[PR][V]**
  - Meta-analysis linking "Google effects" to cognitive load, behavioural phenotype and cognitive self-esteem. People with a larger knowledge base are less susceptible.
  - *The effects depend on prior knowledge. An expert thinking aloud about their own domain may be less at risk than a novice.*
- **Fisher, M., Goddu, M. K. & Keil, F. C. (2015). Searching for explanations: How the Internet inflates estimates of internal knowledge. *JEP: General* 144(3):674–687.** https://doi.org/10.1037/xge0000070 **[PR][DK]** and **Ward, A. F. (2021). People mistake the internet's knowledge for their own. *PNAS* 118(43):e2105061118.** https://doi.org/10.1073/pnas.2105061118 **[PR][DK]**
  - Access to an external knowledge source inflates people's estimates of what they themselves know.
  - *Predicts a specific risk for Souffleur: users may feel they "have thought something through" when the board holds a tidy LLM summary of it. This is a metacognitive-illusion measure worth probing in interviews.*

**Experimental evidence on benefits and costs**
- **Storm, B. C. & Stone, S. M. (2015). Saving-enhanced memory: The benefits of saving on the learning and remembering of new information. *Psychological Science* 26(2):182–188.** https://doi.org/10.1177/0956797614559285 (APS page: https://www.psychologicalscience.org/journals/psychological-science/0956797614559285/) **[PR][V]**
  - Across 3 experiments, saving one file before studying another improved memory for the new file. The benefit disappeared when saving was *unreliable* or when the saved content was too small to interfere.
  - *The strongest experimental support for "offload what you hold to free the mind": offloading frees capacity only if the store is trusted. Reliability of transcription and extraction is therefore a precondition of the design principle, not a nicety.*
- **Grinschgl, S., Papenmeier, F. & Meyerhoff, H. S. (2021). Consequences of cognitive offloading: Boosting performance but diminishing memory. *Quarterly Journal of Experimental Psychology* 74(9).** https://doi.org/10.1177/17470218211008060 **[PR][V]**
  - More offloading improved immediate task performance but reduced memory accuracy in a surprise test. Making offloading more costly reduced offloading and improved memory. Offloading hurt memory mainly when people had *no explicit intention* to remember.
  - *Relieving people of holding items trades away their own memory of those items. Whether that matters depends on whether users intend to remember. The board shifts the job to re-finding.*
- **Gilbert, S. J., Bird, A., Carpenter, J., Fleming, S. M., Sachdeva, C. & Tsai, P.-C. (2020). Optimal use of reminders: Metacognition, effort, and cognitive offloading. *JEP: General* 149:501–517.** https://pubmed.ncbi.nlm.nih.gov/31448938/ **[PR][V]**
  - People were biased toward external reminders even when it cost them money. The bias was stable over time, was predicted by metacognitive *underconfidence*, and was eliminated by metacognitive advice.
  - *Over-offloading is the default human tendency. A system that makes offloading frictionless will amplify it. This is a reason to check whether heavy users (for example the 36-drive participant) capture beyond what they need.*
- **Gilbert, S. J., Boldt, A., Sachdeva, C., Scarampi, C. & Tsai, P.-C. (2023; online 2022). Outsourcing memory to external tools: A review of "intention offloading". *Psychonomic Bulletin & Review* 30:60–76.** https://pmc.ncbi.nlm.nih.gov/articles/PMC9971128/ **[PR][V]**
  - Intention offloading (calendars, placed objects, phone alerts) is highly effective for carrying out delayed intentions. People show stable individual biases in offloading, driven partly by metacognition. Much less is known about offloading than about brain-based prospective memory.
  - *The single best anchor for the "holding" half of the design principle. It names intention offloading as a distinct construct and calls out an empirical gap that a field study can speak to.*
- **Chiappe, D., Vu, K.-P. L. & Tornquist, M. (2025). The role of short-term memory, type of practice and metacognitive judgments in predicting cognitive offloading. *Frontiers in Cognition*.** https://doi.org/10.3389/fcogn.2025.1595956 **[PR][V]**
  - Offloading rose with task difficulty. Motivation to perform well predicted offloading frequency, while confidence and effort judgments did not. Short-term memory capacity predicted offloading only at intermediate difficulty.
  - *Commuting while driving is a high-load context, so offloading should be high there. Motivation, rather than self-rated memory, may drive use.*
- **Fellers, C. & Storm, B. C. (2026). Offloading reduces prospective memory learning. *Journal of Experimental Psychology: Learning, Memory, and Cognition*.** Summary: https://www.psypost.org/relying-on-reminders-could-be-weakening-your-memory-skills/ **[PR][V-sec]**
  - Experiment 1: n = 130, 108 after exclusions. Experiment 2: n = 280.
  - With a reminder, people almost never forgot the supported task. After reminders were removed, prior reminder users remembered fewer future tasks than people who had never used reminders, and fell *below* the no-reminder baseline. More explicit reminders also hurt performance on tasks that had not been offloaded.
  - *The most important 2026 caveat for the design principle. Even offloading of "holding" has a learning cost when the support is later withdrawn. Ending a deployment is exactly that kind of withdrawal, so consider a post-study check of unaided recall of open loops.*
- **Kalnikaité, V. & Whittaker, S. (2007). Software or wetware? Discovering when and why people use digital prosthetic memory. *CHI 2007* (Best Paper).** https://talks.cam.ac.uk/talk/index/8325/ **[PR][V for existence and finding; ACM DOI not checked]**
  - Whether people used prosthetic memory depended on how good they judged their own memory to be and on device properties. People traded accuracy for efficiency, preferring fast access to possibly inaccurate information over slow access to accurate information.
  - *HCI precedent that re-finding cost decides whether external memory is used. The desk-side board has to be quicker to consult than the user's own memory.*
- **Bainbridge, L. (1983). Ironies of automation. *Automatica* 19(6):775–779.** https://doi.org/10.1016/0005-1098(83)90046-8 **[PR][DK; cited as framing by Lee et al. 2025]**
  - Automating routine work removes the practice people need to handle exceptions.
  - *The classic warning against offloading the "thinking". It supports leaving judgement with the user.*

### Inferences
- The foundational literature backs the holding/thinking asymmetry on two grounds. (a) Intention offloading is the best-evidenced *beneficial* case (Gilbert et al. 2023). (b) Saving-enhanced memory shows that offloading held items frees capacity for other cognition (Storm & Stone 2015).
- The same literature says relieving people of holding has three conditions or costs:
  - It needs a reliable store (Storm & Stone).
  - It reduces internal memory of what was offloaded (Grinschgl 2021) and the learning of intentions (Fellers & Storm 2026).
  - It is chosen on metacognitive grounds that are often miscalibrated toward over-offloading (Gilbert 2020).
- For the paper, the principle should therefore be framed as a *bet with known costs*, not a free lunch.
- None of these accounts was built on voice capture, commuting or LLM-structured stores. They predict effects of *storage*, not of *interpretation*. Souffleur's LLM extraction step (turning speech into topics, tasks and notes) is a hybrid that the classic theory does not cover.

### Gaps
- I did not fetch the full text of Risko & Gilbert (2016), Clark & Chalmers (1998) or Wegner (1987) in this session. They are canonical, but check page numbers.
- Fellers & Storm (2026) was verified only through a PsyPost summary. Check the DOI and the exact effect sizes before citing.
- I found no study testing intention offloading where the external agent *re-words or restructures* the intention, which is what Souffleur's LLM extraction does. Chi et al. (2026) in Q5 is the closest.

---

## 2. Offloading to generative AI / LLMs (2023–2026): metacognitive laziness, critical thinking, cognitive debt, deskilling — and the memory/tracking versus reasoning/generation distinction

### Takeaway
Since 2024 the evidence has converged on one pattern: when GenAI does the **generation or reasoning** (writing, problem solving, synthesis, coding, inquiry), immediate output improves but **learning, recall, transfer, ownership and critical engagement decline**. Several studies show the decline is **not inevitable**: it depends on interaction patterns, guardrails and provocations. Almost none of this evidence concerns offloading of **memory or tracking**. That leaves room to argue empirically that the two kinds of offloading differ, but the claim currently rests mostly on the absence of contrary evidence.

### Cited Findings

**Learning and education (mostly RCTs)**
- **Fan, Y., Tang, L., Le, H., Shen, K., Tan, S., Zhao, Y., Shen, Y., Li, X. & Gašević, D. (2025). Beware of metacognitive laziness: Effects of generative artificial intelligence on learning motivation, processes, and performance. *British Journal of Educational Technology* 56(2):489–530.** https://doi.org/10.1111/bjet.13544 **[PR][V title/venue; DOI DK]**
  - Randomised design: N = 117 students, 4 conditions (ChatGPT, human expert, writing analytics, control). ChatGPT improved essay scores but did not improve knowledge gain or transfer. The authors coin "metacognitive laziness": the user hands self-regulatory work to the AI.
  - *A key term. Souffleur's claim is that it removes holding work, not self-regulation (planning, monitoring, evaluating). The study can check whether users still evaluate and revise what the agent drafts.*
- **Stadler, M., Bannert, M. & Sailer, M. (2024). Cognitive ease at a cost: LLMs reduce mental effort but compromise depth in student scientific inquiry. *Computers in Human Behavior*.** https://opus.bibliothek.uni-augsburg.de/opus4/frontdoor/index/index/docId/114673 **[PR][V]**
  - N = 91 students, randomised to ChatGPT or Google. The LLM group reported lower cognitive load but produced lower-quality reasoning and argumentation.
  - *Direct evidence that "lower mental load" and "less thinking" can go together. Souffleur therefore cannot use reduced workload (for example NASA-TLX) on its own as a success measure.*
- **Bastani, H., Bastani, O., Sungu, A., Ge, H., Kabakcı, Ö. & Mariman, R. (2025). Generative AI without guardrails can harm learning: Evidence from high school mathematics. *PNAS* 122(26):e2422633122.** https://doi.org/10.1073/pnas.2422633122 (record: https://ideas.repec.org/a/nas/journl/v122y2025pe2422633122.html) **[PR][V; full author list DK]**
  - Field experiment with about 1,000 students. During practice, performance rose 48% with plain GPT-4 and 127% with a GPT tutor that had learning safeguards.
  - After access was removed, the plain-GPT group did 17% worse than controls. The guardrails largely mitigated the harm.
  - *Design determines whether AI is a crutch. Cite this for the claim that a principled boundary on what the agent will do can preserve thinking.*
- **Melumad, S. & Yun, J. H. (2025). Experimental evidence of the effects of large language models versus web search on depth of learning. *PNAS Nexus* 4:pgaf316.** https://doi.org/10.1093/pnasnexus/pgaf316 **[PR][V]**
  - Across 7 experiments, learning from an LLM synthesis produced shallower knowledge than web search, even with the same facts and even with links added. Advice written afterwards was sparser, less original and less often adopted.
  - *Relevant to Souffleur's **extraction/summary** step. An LLM-written summary of the user's own thoughts may itself be a form of synthesis offloading. This is a real tension for "never relieve the thinking", because the system's summarising is a kind of thinking.*
- **Shen, J. H. & Tamkin, A. (2026). How AI impacts skill formation. arXiv:2601.20245 (Anthropic Fellows Program).** https://arxiv.org/abs/2601.20245 **[Preprint][V]**
  - Randomised experiments on learning a new asynchronous programming library. AI assistance impaired conceptual understanding, code reading and debugging, with no significant average efficiency gain. Of 6 identified interaction patterns, 3 involve cognitive engagement and preserved learning.
  - *2026 evidence that the harm depends on the interaction pattern. Supports analysing Souffleur logs by *pattern* (for example asking the agent to think versus thinking aloud and having it captured), not just by usage volume.*

**Knowledge work and reasoning**
- **Lee, H.-P. (Hank), Sarkar, A., Tankelevitch, L., Drosos, I., Rintel, S., Banks, R. & Wilson, N. (2025). The impact of generative AI on critical thinking: Self-reported reductions in cognitive effort and confidence effects from a survey of knowledge workers. *CHI 2025*.** https://doi.org/10.1145/3706598.3713778 **[PR][V]**
  - Survey: N = 319, 936 real task examples, critical thinking framed with Bloom's taxonomy.
  - Higher confidence in GenAI went with less critical thinking. Higher self-confidence went with more critical thinking, and with more perceived effort.
  - GenAI shifted critical thinking toward information verification, response integration and "task stewardship". Barriers to critical thinking were lack of awareness, time pressure, and difficulty improving AI output in unfamiliar domains.
  - *The canonical HCI reference. The "task stewardship" shift is useful: Souffleur aims to keep users as stewards of their own open loops and owners of the substance.*
- **Gerlich, M. (2025). AI tools in society: Impacts on cognitive offloading and the future of critical thinking. *Societies* 15(1):6.** https://doi.org/10.3390/soc15010006 (SSRN: https://papers.ssrn.com/abstract=5082524) **[PR][V title/venue/findings]**
  - Mixed methods: N = 666 surveys plus interviews. A strong negative correlation between AI-tool use and critical thinking, mediated by cognitive offloading. Younger users (17–25) were more dependent; higher education buffered the effect.
  - *Widely cited but cross-sectional and self-report, so it cannot establish causation. Use it as motivation, not evidence. Its construct of "offloading" lumps memory and reasoning together, which is exactly the conflation Souffleur's framing can sharpen.*
- **Kosmyna, N., Hauptmann, E., Yuan, Y. T., Situ, J., Liao, X.-H., Beresnitzky, A. V., Braunstein, I. & Maes, P. (2025). Your brain on ChatGPT: Accumulation of cognitive debt when using an AI assistant for essay writing task. arXiv:2506.08872.** https://arxiv.org/abs/2506.08872 (project: https://www.media.mit.edu/publications/your-brain-on-chatgpt/) **[Preprint][V]**
  - Groups: LLM, search engine and brain-only, over 3 sessions (N = 54). In session 4 (n = 18) the conditions were crossed over.
  - EEG connectivity scaled down with the amount of external support. Summaries report the lowest self-reported ownership and the poorest ability to recall or quote one's own essay in the LLM group.
  - Coins **"cognitive debt"**: the cumulative cost of offloading.
  - *The source of the "cognitive debt" term. Note that its evidence is generative offloading (writing the essay), not memory offloading.*
- **Stanković, M., Hirche, E., Kollatzsch, S. & Doetsch, J. N. (2026). Comment on: Your brain on ChatGPT. arXiv:2601.00856.** https://arxiv.org/abs/2601.00856 **[Preprint commentary][V]**
  - Raises concerns about the small sample, reproducibility, the EEG analysis pipeline, inconsistent reporting, and interpretations made without statistical tests. Notes **greater** beta-band engagement in the LLM condition, which complicates the headline conclusion.
  - *Cite Kosmyna together with this critique. As of these searches I found no peer-reviewed version of Kosmyna et al. Treat "cognitive debt" as a provocative concept rather than an established effect.*
- **Shaw, S. & Nave, G. (2026). Thinking—fast, slow, and artificial: How AI is reshaping human reasoning and the rise of cognitive surrender. SSRN 6097646.** https://papers.ssrn.com/abstract=6097646 **[Preprint][V; numbers via secondary summaries]**
  - Proposes "Tri-System Theory", in which AI acts as an external "System 3".
  - 3 experiments: more than 1,300 participants, about 10,000 trials. Accuracy rose about 25 percentage points when the AI was right and fell about 15 points when it was wrong. The authors call this "cognitive surrender": adopting AI decisions as one's own without noticing the transfer.
  - *A 2026 term that sits next to "cognitive debt". Souffleur's proactive "offers" (agendas, drafts) are the moments where surrender could happen and should be observed.*
- **Tankelevitch, L., Kewenig, V., Simkute, A., Scott, A. E., Sarkar, A., Sellen, A. & Rintel, S. (2024). The metacognitive demands and opportunities of generative AI. *CHI 2024* (Best Paper).** https://arxiv.org/abs/2312.10893 **[PR][V; full author list DK]**
  - GenAI demands heavy metacognitive monitoring and control (prompting, evaluating output, deciding when to rely on it). Proposes building metacognitive support into the system.
  - *Offloading to GenAI adds a new metacognitive load while removing other load. A voice agent in the car makes this worse because outputs are hard to evaluate eyes-free. This supports deferring evaluation to the desk.*
- **Si, S., Qi, Y., Xu, J. & Qi, X. (2026). When thinking is outsourced: Cognitive offloading and the heterogeneity of critical thinking among Chinese university students using generative AI. *Journal of Intelligence* 14(7):116.** https://doi.org/10.3390/jintelligence14070116 **[PR][V]**
  - Cross-sectional, N = 353. Four profiles, from simple Q&A users (25.2%) to "critical co-thinkers" (15.6%). Learning motivation predicted critical-thinking gains (β = .42) and lower dependence (β = −.35). Deeper offloading predicted more dependence (β = .25).
  - *Use profiles rather than averages. A heavy user is not automatically a "dependent" user.*

**Deskilling in practice**
- **Budzyń, K. et al. (2025). Endoscopist deskilling after exposure to artificial intelligence in colonoscopy: a multicenter observational study. *Lancet Gastroenterology & Hepatology*.** https://wrap.warwick.ac.uk/id/eprint/191005 **[PR][V]**
  - Adenoma detection rate in *non-AI* colonoscopy fell from 28.4% to 22.4% (−6.0 points) after clinicians were routinely exposed to AI. The clinicians were experienced (more than 2,000 colonoscopies each). Observational design.
  - *Real-world evidence that a skill can erode when AI assistance is continuous. A useful contrast case: perceptual and judgement skill is "thinking", which Souffleur does not take over.*

**Design countermeasures (thinking-preserving AI)**
- **Buçinca, Z., Malaya, M. B. & Gajos, K. Z. (2021). To trust or to think: Cognitive forcing functions can reduce overreliance on AI in AI-assisted decision-making. *PACM HCI* 5(CSCW1).** https://arxiv.org/abs/2102.09692 **[PR][V]**
  - Explanations alone did not reduce overreliance. Cognitive forcing functions (added friction) did, at some cost to user experience.
  - *Pre-GenAI foundation for adding deliberate friction to protect thinking.*
- **Danry, V., Pataranutaporn, P., Mao, Y. & Maes, P. (2023). Don't just tell me, ask me: AI systems that intelligently frame explanations as questions improve human logical discernment accuracy. *CHI 2023*.** https://dspace.mit.edu/handle/1721.1/150613 **[PR][V]**
  - Explanations framed as questions improved people's logical discernment compared with explanations given as answers.
  - *Directly usable for the voice agent: asking the user questions rather than handing back conclusions is an evidence-based way to keep the thinking with them.*
- **Drosos, I., Sarkar, A., Xu, X. (Tone) & Toronto, N. (2025). "It makes you think": Provocations help restore critical thinking to AI-assisted knowledge work. arXiv:2501.17247.** https://arxiv.org/abs/2501.17247 **[Preprint][V]**
  - N = 24. Short provocations (critiques and alternatives to AI suggestions) induced critical and metacognitive thinking. Whether they helped depended on task urgency, importance, user expertise, how actionable the provocation was, and the user's sense of responsibility.
  - *Souffleur's proactive "offers" could take the form of provocations rather than finished answers.*
- **(Title only) An experimental comparison of cognitive forcing functions for execution plans in AI-assisted writing: Effects on trust, overreliance, and perceived critical thinking. arXiv:2601.18033 (2026).** https://arxiv.org/abs/2601.18033 **[Preprint; only the title appeared in search results; contents not checked]**

**Measurement or self-report tools (2025–2026)**
- **Lau, G. R., Low, W. Y., Tay, L., Guevarra, Y., Gašević, D. & Hartanto, A. (2026). Understanding critical thinking in generative AI use: Development, validation, and correlates of the Critical Thinking in AI Use Scale. *Computers in Human Behavior Reports* 22:101103.** https://arxiv.org/abs/2512.12413 **[PR][V]**
  - 13 items, 3 factors (Verification, Motivation, Reflection), 6 studies, N = 1,341. Higher scores predicted more verification and more accurate veracity judgements in a chatbot fact-checking task.
  - *A ready-made validated trait measure for screening participants or for pre/post comparison.*
- **Alam, M. U. (2026). PAUSE: A privacy-preserving self-reflection tool for AI-associated cognitive offloading. arXiv:2609.13155.** https://arxiv.org/abs/2609.13155 **[Preprint][V]**
  - Defines AI-associated cognitive offloading as "the pattern where a person routinely substitutes LLM output for their own reasoning, idea generation, learning, or communication". Explicitly *not* a validated instrument.
  - *Useful evidence that the 2026 discourse defines problematic AI offloading entirely as reasoning, generation and communication, not memory or tracking. That supports Souffleur's distinction.*

### Inferences
- **Memory/tracking versus reasoning/generation.** Every 2024–2026 harm study I found manipulated *generative or reasoning* offloading:
  - essays (Kosmyna; Fan)
  - inquiry and synthesis (Stadler; Melumad & Yun)
  - problem solving (Bastani)
  - coding (Shen & Tamkin)
  - decisions (Shaw & Nave; Buçinca)
  - perceptual judgement (Budzyń)

  None tested whether offloading *intentions or open loops* to an LLM harms reasoning. The psychology evidence on memory offloading (Q1) shows costs to *memory of the offloaded items* (Grinschgl; Fellers & Storm), not to reasoning. Souffleur's position, "offload holding, keep thinking", is consistent with both literatures and fills a gap between them. It should be framed as a hypothesis, not a demonstrated result.
- **The boundary leaks in three places in Souffleur:**
  1. LLM extraction and summarisation of the user's speech is synthesis (Melumad & Yun suggest it may produce shallower understanding).
  2. Drafts written by the agent are generation offloading (Kosmyna, Fan, Draxler).
  3. Proactive offers such as agendas are moments where cognitive surrender can occur (Shaw & Nave).

  An honest framing names these as places where holding-relief can slide into thinking-relief, and treats observing them as a research goal.
- **Lower load is not the outcome to maximise.** Stadler (2024) and Lee (2025) show reduced effort alongside reduced thinking. Souffleur's evaluation should pair a load-relief measure with a thinking-preserved measure (see Q5).
- **Heterogeneity is the rule** (Shen & Tamkin's 6 patterns; Si et al.'s 4 profiles; Lee's confidence effects). This suits a formative study with one heavy and several light users: describe patterns, not averages.

### Gaps
- No peer-reviewed version of Kosmyna et al. was found. The two key numbers cited in summaries (ownership, quoting ability) should be checked against the arXiv PDF before use.
- The Shaw & Nave numbers (+25 / −15 percentage points) came from secondary write-ups, not the SSRN PDF.
- I found no 2025–2026 study that directly compares offloading *memory or intentions* to an LLM with offloading *reasoning* to an LLM within one design. This is the clearest gap.
- I did not verify any formal published rebuttal of Gerlich (2025) or Fan et al. (2025). Their limitations noted above are my own assessment.

---

## 3. Offloading open loops / unfinished tasks: Zeigarnik, plan making, task capture, and whether captured items "come back"

### Takeaway
The intuition that unfinished tasks "nag" is partly right and partly folklore.
- The classic Zeigarnik *memory* advantage for unfinished tasks does **not** replicate in meta-analysis. The *tendency to resume* them (Ovsiankina) does.
- The best-known relief mechanism is **making a specific plan**, not mere capture (Masicampo & Baumeister 2011).
- Writing a specific to-do list measurably speeds sleep onset (Scullin et al. 2018).
- On the commute specifically, *thinking about the upcoming work role* buffers the costs of long commutes (Jachimowicz et al. 2021).

HCI work on capture tools (information scraps, lifelogging) repeatedly warns that capture is easy and **retrieval and use** are where systems fail. I found little recent work that measures follow-through on captured items.

### Cited Findings
- **Zeigarnik, B. (1927). Über das Behalten von erledigten und unerledigten Handlungen. *Psychologische Forschung* 9:1–85.** **[PR][DK; foundational]**
  - The original claim that interrupted tasks are recalled better than completed ones.
- **Ghibellini, R. & Meier, B. (2025). Interruption, recall and resumption: a meta-analysis of the Zeigarnik and Ovsiankina effects. *Humanities and Social Sciences Communications* 12.** https://doi.org/10.1057/s41599-025-05000-w **[PR][V]**
  - 59 studies (count from secondary summary). No memory advantage for unfinished tasks: the recall ratio was about 0.99, d about 0.15. There was a general tendency to resume unfinished tasks. The authors suggest the Zeigarnik effect depends on context (experimenter authority, task involvement).
  - *Do not frame Souffleur around "the Zeigarnik effect makes open loops nag". Frame it around the **Ovsiankina resumption tendency** and the plan-making account below.*
- **Masicampo, E. J. & Baumeister, R. F. (2011). Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals. *Journal of Personality and Social Psychology* 101(4):667–683.** https://doi.org/10.1037/a0024192 **[PR][V-sec for findings; DOI DK]**
  - Unfulfilled goals caused intrusive thoughts during an unrelated reading task, higher accessibility of goal-related words, and worse anagram performance. Making a *specific plan* (when, where, how) eliminated these effects even though the goal was still unfinished.
  - *Central for Souffleur, with a twist: the relief came from the person **making a plan**, a small act of thinking, not from handing the item to someone else. A thinking partner that prompts the user to state the next step and when they will do it fits the evidence better than silent extraction does.*
  - **Replication caveat:** I found no direct published replication or failed replication in this session. Treat it as an influential single paper from the ego-depletion era. See Gaps.
- **Scullin, M. K., Krueger, M. L., Ballard, H. K., Pruett, N. & Bliwise, D. L. (2018). The effects of bedtime writing on difficulty falling asleep: A polysomnographic study comparing to-do lists and completed activity lists. *JEP: General* 147(1):139–146.** https://pubmed.ncbi.nlm.nih.gov/29058942/ **[PR][V; author list DK]**
  - N = 57, measured with lab polysomnography. Writing a to-do list for 5 minutes before bed led to falling asleep about 9 minutes faster than writing about completed activities. (From domain knowledge: more specific to-do lists predicted faster sleep onset. Re-check.)
  - *Rare objective (physiological) evidence that externalising future tasks relieves mental load. A model for "load relief" outcomes that are not self-report.*
- **Jachimowicz, J. M., Cunningham, J. L., Staats, B. R., Gino, F. & Menges, J. I. (2021). Between home and work: Commuting as an opportunity for role transitions. *Organization Science*.** https://www.repository.cam.ac.uk/handle/1810/302690 **[PR][V]**
  - Three field studies, N = 1,736, including a 4-week intervention. Long morning commutes lowered job satisfaction and raised turnover for employees with low self-control or high work–family conflict. "Role-clarifying prospection" (thinking about the upcoming work role) buffered these effects.
  - *Strong ecological support for the commute as a time for thinking ahead. Souffleur can be framed as scaffolding role-clarifying prospection and capturing what it produces, not as filling "dead time".*
- **Heylighen, F. & Vidal, C. (2008). Getting Things Done: The science behind stress-free productivity. *Long Range Planning* 41(6):585–605.** https://web-archive.southampton.ac.uk/cogprints.org/6289/ **[PR][V]**
  - A theory paper grounding Allen's (2001) GTD method in situated, embodied and distributed cognition. The brain relies on the environment as external memory, as a trigger for action and as a source of feedback. GTD works by turning tasks into "actionable" external memories.
  - *The academic citation for GTD-style capture ("mind like water"). Note it is argumentative, not empirical.*
- **Sellen, A. J. & Whittaker, S. (2010). Beyond total capture: A constructive critique of lifelogging. *Communications of the ACM* 53(5):70–77.** https://www.microsoft.com/en-us/research/?p=159460 **[PR][V; DOI 10.1145/1735223.1735243 DK]**
  - Critiques "capture everything" systems for unclear value. Proposes five uses: recollecting, reminiscing, retrieving, reflecting and **remembering intentions**. Systems should support human memory, not replace it.
  - *Place Souffleur under "remembering intentions" and "reflecting". It also supplies the critique to pre-empt: capture without a clear path back to use has little value.*
- **Bernstein, M., Van Kleek, M., Karger, D. & schraefel, m.c. (2008). Information scraps: How and why information eludes our personal information management tools. *ACM TOIS* 26(4).** https://doi.org/10.1145/1402256.1402263 **[PR][DK]**
  - Many personal notes and reminders end up as "scraps" outside formal PIM tools because capture must be quick and the information does not fit the tool's categories.
  - *Spoken thoughts in the car are typical scraps. Souffleur's LLM structuring is an attempt to turn scraps into organised items without making capture slower.*
- **Bellotti, V., Dalal, B., Good, N., Flynn, P., Bobrow, D. G. & Ducheneaut, N. (2004). What a to-do: Studies of task management towards the design of a personal task list manager. *CHI 2004*.** https://doi.org/10.1145/985692.985785 **[PR][DK]**
  - Field study of how people manage to-dos. Lists are kept, but managing them is costly, and prioritising and reminding at the right moment matter more than listing.
  - *Precedent for the claim that the hard part of an open-loop system is getting items back at the right time, not capturing them.*
- **Kalnikaité & Whittaker (2007)** (see Q1): people use prosthetic memory only when it beats organic memory on speed. **[PR][V]**
- **Zulfikar, W. D., Chan, S. & Maes, P. (2024). Memoro: Using large language models to realize a concise interface for real-time memory augmentation. *CHI 2024*.** https://dspace.mit.edu/handle/1721.1/155181 **[PR][V]**
  - A wearable, audio-based LLM memory assistant with query and query-less (predictive) modes. In a study of 20 participants it reduced device interaction time and raised recall confidence while preserving conversation quality.
  - *The closest LLM-era system for voice capture with proactive return. Measured outcomes were immediate (in-conversation), not longitudinal follow-through.*

### Inferences
- The strongest framing is to **reposition "open loops" away from Zeigarnik** (not robust) toward three better-supported ideas:
  1. Ovsiankina resumption: people do return to unfinished tasks.
  2. Plan making relieves intrusive goal thoughts.
  3. Externalising specific future tasks relieves pre-sleep load.
- Masicampo & Baumeister imply something sharper than "capture relieves". The relief comes from **specifying the next action**, which is itself thinking. Souffleur could therefore claim that the voice partner relieves *holding* while prompting the small piece of *thinking* (next step, when) that actually closes the loop. This reconciles the two halves of its principle.
- For commuting, Jachimowicz et al. (2021) give a measured benefit of prospective thinking during the commute. This lets the paper say the commute is already used for this kind of thinking, and Souffleur captures it.
- **Return path.** Sellen & Whittaker, Bellotti et al. and Kalnikaité & Whittaker all say the value is in retrieval and timely re-presentation. Souffleur's desk-side board is the return path, so logging board visits, item re-opens and item completion is essential to back any "relief" claim.

### Gaps
- **No replication record found for Masicampo & Baumeister (2011).** It comes from the period and lab associated with ego depletion, which has replication problems. Reviewers may ask about this, so look for registered replications before relying on it.
- **Very little recent HCI work measures whether captured items "come back"** (re-finding, revisits, completion rates) in LLM-structured capture systems. I found no 2023–2026 field study reporting the follow-through rate of voice-captured tasks. Souffleur's logs could supply this.
- I did not find empirical tests of GTD itself (as opposed to theory). Do not claim GTD has been validated.
- I deliberately left out several older detachment and rumination studies (for example Syrek et al. 2017) because I could not confirm their details in this session.

---

## 4. Offloading via voice (voice notes, spoken capture, voice PIM) and thinking during commutes and driving

### Takeaway
Voice capture of thoughts has a long HCI lineage (VoiceNotes, 1993). LLMs have revived it, with work on turning rambling speech into structured text (Rambler, 2024–2025), on wearable voice memory assistants (Memoro, 2024), and on proactive thought partners (2026 preprint).

Driving research gives two facts that frame the study:
1. Drivers already mind-wander about two-thirds of the time on familiar commutes, so the thinking is already happening.
2. Voice interaction is **not** cognitively free while driving, and interference lingers after each interaction.

I found **no** peer-reviewed field study of an LLM voice thinking partner used during real commutes. That is a clear gap for Souffleur.

### Cited Findings

**Voice capture and voice PIM**
- **Stifelman, L. J., Arons, B., Schmandt, C. & Hulteen, E. A. (1993). VoiceNotes: A speech interface for a hand-held voice notetaker. *INTERCHI '93* (CHI 1993).** https://www.media.mit.edu/speech/papers/1993/stifelman_CHI93_voicenotes.pdf **[PR][V]**
  - A voice-controlled hand-held device for creating, managing and retrieving "small segments of digitized speech containing thoughts, ideas, reminders, or things to do".
  - *The foundational ancestor. Its design problem, that audio is hard to browse and retrieve, is what LLM transcription and structuring now address.*
- **Lin, S. et al. (2024). Rambler: Supporting writing with speech via LLM-assisted gist manipulation. *CHI 2024*.** https://arxiv.org/abs/2401.10838 **[PR][V; full author list DK — includes Zamfirescu-Pereira, Hartmann, Liu]**
  - LLM-based "gist extraction" (keywords, summaries) and "macro revision" of dictated text. With 12 participants, it outperformed speech-to-text plus ChatGPT and gave users more control over content.
  - *Closest system precedent for "LLM structures spoken thought". Note that it stresses user control, matching Souffleur's "keep the thinking" stance.*
- **Yang, X., Li, W., Lee, M. G., Li, Z., Zamfirescu-Pereira, J. D. & Liu, C. (2025). Rambler in the wild: A diary study of LLM-assisted writing with speech. arXiv:2502.05612.** https://arxiv.org/abs/2502.05612 **[Preprint/case study][V]**
  - 12 writers, 10-day diary study. Speech plus LLM helped people organise loose thoughts, encouraged reflective writing and journaling, and was valued for "preventing overthinking".
  - It was used mostly at a desk or in bed and rarely outdoors, because of noise and distraction.
  - *Shows that voice capture is usually tied to quiet indoor settings. The car is an unusual private, semi-quiet space, which is a contextual contribution Souffleur can claim.*
- **Kim, J., Laban, P., Chen, X. & Arnold, K. C. (2025). Voice interaction with conversational AI could facilitate thoughtful reflection and substantive revision in writing. *In2Writing Workshop @ NAACL 2025*.** https://arxiv.org/abs/2504.08687 **[Workshop paper][V]**
  - Proposes that voice dialogue about LLM feedback could deepen reflection and lower cognitive load compared with text. Mainly a proposed formative study.
  - *Supports the "voice → reflection" hypothesis but provides no outcome data.*
- **Zulfikar, Chan & Maes (2024). Memoro** (see Q3). **[PR][V]**
  - Audio-based LLM memory assistant. Reduced interaction time and raised recall confidence (N = 20).
- **Zhang, C., Davis, A., Chen, C.-W. & Hsu, C.-C. (2026). Designing proactive thought partners for writing. arXiv:2609.01588.** https://arxiv.org/abs/2609.01588 **[Preprint][V]**
  - One-week technology probe, N = 16. Users configured partner roles and how proactive they were, and used suggestions for both generating ideas and reflecting. They preferred lightweight visual representations and non-directive rhetorical framing for interventions that did not intrude.
  - *The most recent "thought partner" work, but text-based. Its preference for non-directive proactivity matches Souffleur's "offers" and the questions-not-answers result (Danry 2023).*
- **Patterson, M. S., Valdez, D., Yudkin, J. S. & Prochnow, T. (2026). Leveraging voice memos recorded via smartphones for qualitative data collection.** https://journals.sagepub.com/doi/10.1177/22799036261457754 **[PR, methods; V for existence only]**
  - Presents smartphone voice memos as a low-burden way to collect data.
  - *A tangential methods citation if Souffleur's own recordings serve as diary-like data.*
- **Unreliable claim flagged:** commercial voice-note blogs circulate statistics such as "38% higher recall for verbalised fragments (MIT Memory Dynamics Project, 2022)" and "2.3 s overhead per capture (UCSD HCI Lab, 2023)". I could not trace either to a real publication, so **do not cite them.**

**Thinking, mind-wandering and productivity in the car**
- **Burdett, B. R. D., Charlton, S. G. & Starkey, N. J. (2019). Mind wandering during everyday driving: An on-road study. *Accident Analysis & Prevention*.** https://researchcommons.waikato.ac.nz/handle/10289/12097 **[PR][V]**
  - 11 drivers on their own home–work commutes (110 trips), probed for what they were thinking. They reported mind-wandering about two-thirds of the time on familiar urban roads.
  - *Key framing citation: thinking during the commute already happens. Souffleur captures it rather than adding a new task, though talking about it out loud may change it.*
- **Jachimowicz et al. (2021)** (see Q3): role-clarifying prospection during the commute is beneficial. **[PR][V]**
- **Baird, B., Smallwood, J. & Schooler, J. W. (2011). Back to the future: Autobiographical planning and the functionality of mind-wandering. *Consciousness and Cognition* 20(4):1604–1611.** **[PR][DK; DOI not checked]**
  - Mind-wandering leans toward the future and is often autobiographical planning.
  - *Explains why commute mind-wandering produces intentions and open loops, the "holding" content.*
- **Martelaro, N., Teevan, J. & Iqbal, S. T. (2019). An exploration of speech-based productivity support in the car. *CHI 2019*.** https://www.microsoft.com/en-us/research/?p=569166 **[PR][V]**
  - Simulator study in which drivers wrote a document or made slides by speech while driving. It varied how much support the assistant gave and whether it gave road-context alerts.
  - *The closest HCI precedent for in-car speech productivity. It was lab-based and focused on producing artefacts, whereas Souffleur is a field study focused on capturing thought. It names the safety–productivity tension.*
- **Strayer, D. L., Cooper, J. M., Turrill, J., Coleman, J. R. & Hopman, R. J. (2016). Talking to your car can drive you to distraction. *Cognitive Research: Principles and Implications* 1:16.** https://appliedcognition.psych.utah.edu/publications/talk_car_drive_distraction_16.pdf **[PR][V; DOI 10.1186/s41235-016-0018-3 DK]**
  - N = 257, 10 vehicles' in-vehicle information systems. Voice interaction workload was moderate to high (mean 3.34 out of 5, range 2.37–4.57). Better speech recognition meant less distraction. Interference persisted for up to 27 seconds after an interaction ended. "Hands-free does not mean risk-free."
  - *A required citation for safety. A talk-back agent adds workload. Supports designs that are capture-first, keep agent turns short, and defer evaluation of drafts and offers to the desk.*

### Inferences
- The car offers a **natural experiment in modality**. Eyes and hands are busy, so the only offloading channel is voice, and evaluating AI output is constrained. That pushes the system toward *capture now, think and evaluate later at the desk*, which happens to match the holding/thinking principle.
- Strayer et al. warn that the *talk-back* features (answers, drafts, offers) carry the highest load and safety cost. They are also the features most likely to offload thinking. The two concerns, safety and thinking preservation, point the same way.
- Burdett et al. and Jachimowicz et al. together justify the commute as already a site of prospective thinking. This rebuts a likely reviewer objection that the study adds cognitive work to driving.

### Gaps
- **No peer-reviewed in-the-wild study of an LLM voice assistant used for thinking aloud, capture or reflection during real commutes was found.** Martelaro et al. (2019) used a simulator and Burdett et al. (2019) did not involve an assistant.
- I found no recent HCI paper specifically on *voice-based personal information management* or on what happens to voice memos later (retrieval rates, revisits). Commercial apps dominate the search results.
- I found no study measuring whether *speaking* thoughts (versus thinking silently) on a commute changes their quality. Self-explanation research (Q5) suggests it might, but this has not been tested in driving.
- Newer data on the safety of LLM voice agents in cars (2024–2026) was not found in this pass. The Strayer et al. findings predate LLM voice agents.

---

## 5. Constructs and measures for "mental load relief" versus "thinking preserved"; agency and ownership of AI-assisted thinking

### Takeaway
No single instrument captures "relief of holding without loss of thinking". The literature supplies parts for a paired measurement strategy:
- **Load and relief:** workload (NASA-TLX, in-vehicle workload scales), intrusive thoughts and goal accessibility (Masicampo & Baumeister), sleep-onset latency (Scullin), and offloading bias and confidence (Gilbert).
- **Thinking preserved:** critical-thinking enaction (Lee et al.; the Critical Thinking in AI Use Scale), recall of and ability to quote one's own work (Kosmyna), unaided transfer (Fan; Bastani; Shen & Tamkin), and self-explanation.
- **Ownership and agency:** psychological ownership (Joshi & Vogel; Draxler et al.), and ownership as the mediator of follow-through on AI-authored goals (Chi et al. 2026).

The 2026 goal study is especially relevant: **AI-authored goals scored higher on quality but were less owned and less acted upon.**

### Cited Findings

**Load and relief**
- **Hart, S. G. (2006). NASA-Task Load Index (NASA-TLX); 20 years later. *Proc. HFES Annual Meeting* 50(9):904–908.** https://doi.org/10.1177/154193120605000909 **[PR][DK]** (original: Hart & Staveland 1988)
  - A multidimensional workload measure: mental, physical and temporal demand, performance, effort, frustration.
  - *Measures load during a task. It does not measure the background load of carrying open loops, and Stadler (2024) shows that lower TLX-type load can go with less thinking. Use it only alongside thinking measures.*
- **Strayer et al. (2016)**: a 5-point cognitive workload rating for in-vehicle voice interactions, plus measures of lingering interference. **[PR][V]**
  - *A domain-specific load measure for the in-car part of the study.*
- **Masicampo & Baumeister (2011)**: intrusive thoughts during reading, lexical accessibility of goal words, and performance on an unrelated anagram task. **[PR][V-sec]**
  - *The best-established operationalisation of open-loop burden. A light field version could be experience-sampling questions such as "how often did unfinished X intrude today?", asked before and after capture.*
- **Scullin et al. (2018)**: sleep-onset latency as an objective proxy for relief of future-task worry. **[PR][V]**
- **Gilbert et al. (2020); Chiappe et al. (2025)**: offloading bias (preferring a reminder over one's own memory), confidence calibration, and motivation as predictors. **[PR][V]**
  - *Measure each participant's memory confidence and offloading bias at intake. This explains individual differences in how much they capture.*

**Thinking preserved**
- **Lee et al. (2025)**: self-reported enaction of critical thinking and perceived effort, using Bloom's taxonomy categories. Confidence in AI and self-confidence are the key predictors. **[PR][V]**
- **Lau et al. (2026): Critical Thinking in AI Use Scale.** 13 items covering Verification, Motivation and Reflection. **[PR][V]**
- **Kosmyna et al. (2025)**: EEG connectivity, ability to quote one's own essay, and self-reported ownership. **[Preprint][V]**
  - *Being able to recall and quote one's own output cheaply indicates whether the person did the thinking. For Souffleur: can users recall, without the board, what they concluded on a given drive?*
- **Fan et al. (2025); Bastani et al. (2025); Shen & Tamkin (2026)**: unaided transfer or post-test performance after AI support is removed. **[PR/Preprint][V]**
  - *The gold standard for "thinking preserved". Hard to do in a field study, but an approximation is possible (see Inferences).*
- **Chi, M. T. H., de Leeuw, N., Chiu, M.-H. & LaVancher, C. (1994). Eliciting self-explanations improves understanding. *Cognitive Science* 18(3):439–477.** https://doi.org/10.1207/s15516709cog1803_3 **[PR][DK; foundational]**
  - Prompting learners to explain material to themselves improved understanding.
  - *Theoretical grounding for why thinking aloud to a partner may itself preserve or strengthen thinking. Voice capture may be a self-explanation intervention as well as a way of offloading.*
- **Tankelevitch et al. (2024)**: a framework for the metacognitive monitoring and control that GenAI demands. **[PR][V]**
  - *Can be used as a coding scheme for interview data: when did users monitor or evaluate the agent's output, and when did they not?*

**Agency and ownership**
- **Draxler, F., Werner, A., Lehmann, F., Hoppe, M., Schmidt, A., Buschek, D. & Welsch, R. (2024). The AI ghostwriter effect: When users do not perceive ownership of AI-generated text but self-declare as authors. *ACM TOCHI* 31(2).** https://arxiv.org/abs/2303.03283 **[PR][V; full author list DK]**
  - Two studies (n = 30, n = 96). Users did not feel they owned AI-generated text but still declared themselves the author. Personalisation did not change this. More control over the model increased ownership.
  - *For Souffleur's drafts and macros: separate felt ownership from declared authorship, and expect user control to raise ownership.*
- **Joshi, N. & Vogel, D. (2024/2025). Writing with AI lowers psychological ownership, but longer prompts can help. arXiv:2404.03108.** https://arxiv.org/abs/2404.03108 **[Preprint; peer-reviewed venue not verified][V]**
  - Writing with AI lowered psychological ownership. Longer, more effortful prompts raised it.
  - *Thinking aloud at length before the agent drafts anything is like a "long prompt". The prediction is that Souffleur drafts based on extended user monologue will keep more ownership than drafts produced on demand.*
- **Chi, V. B., Rietsche, R., Göldi, A., Ungar, L. & Guntuku, S. C. (2026). Optimized but unowned: How AI-authored goals undermine the motivation they are meant to drive. arXiv:2605.12344.** https://arxiv.org/abs/2605.12344 **[Preprint, preregistered][V]**
  - N = 470. LLM-written goals scored higher on SMART criteria but produced lower psychological ownership, commitment and perceived importance.
  - At 2 weeks, 72.8% of people with self-authored goals had acted on several goals, against 46.6% with LLM-authored goals. Ownership mediated every downstream motivational outcome, and the effect was strongest for people low in self-efficacy.
  - *The most directly relevant 2026 finding for Souffleur's task extraction. If the LLM **rewrites** a user's spoken intention into a polished task, it may lower ownership and follow-through. Design implication: keep the user's own words (verbatim quotes) attached to extracted tasks, and measure follow-through.*
- **Limerick, H., Coyle, D. & Moore, J. W. (2014). The experience of agency in human-computer interactions: a review. *Frontiers in Human Neuroscience* 8:643.** https://doi.org/10.3389/fnhum.2014.00643 **[PR][DK]**
  - Reviews sense of agency (implicit measures such as intentional binding, and explicit judgements) in HCI.
  - *Background on agency measures if the paper uses "agency" formally rather than loosely.*
- **Shaw & Nave (2026)**: "cognitive surrender" is defined partly by people *not noticing* that a decision was transferred. **[Preprint][V]**
  - *Interviews should probe whether users can tell which ideas on their board came from them and which came from the agent. That is source monitoring as an ownership measure.*

### Inferences
- A defensible **paired-outcome** design for a formative study:
  - **Relief of holding:**
    1. Experience-sampling or weekly ratings of open-loop intrusiveness ("unfinished things on my mind").
    2. Logged capture volume, board revisits and item completion, i.e. whether items come back.
    3. Perceived memory load, using a short NASA-TLX-style item specific to keeping track.
  - **Thinking preserved:**
    1. Unaided recall: before opening the board, ask users to state what they concluded on recent drives, then compare with the board.
    2. Source attribution: did this idea come from you or from Souffleur?
    3. Psychological ownership of board items and drafts.
    4. Critical Thinking in AI Use Scale (Lau et al. 2026) at intake.
    5. Coding of interview data for verification, editing and rejection of agent output (Lee 2025; Tankelevitch 2024).
- Ownership is turning out to be the **mediator** between AI help and real-world action (Chi et al. 2026; Draxler 2024; Joshi & Vogel). For a system whose value is follow-through on open loops, ownership is not a "soft" UX metric. It sits on the causal path.

### Gaps
- No validated scale for "open-loop burden" or "mental load of unfinished tasks" in HCI settings was found. Researchers have adapted rumination and detachment scales from occupational psychology, but I did not verify specific instruments in this session.
- No validated measure of "cognitive ownership" of *ideas*, as opposed to *text*, was found. Existing ownership studies concern written artefacts. Ideas extracted from one's own speech are a new case.
- Joshi & Vogel's venue was not confirmed. A University of Waterloo page suggested a 2026 venue, but I could not verify it.

---

## 6. Open gaps a field study of a voice thinking partner could claim

### Takeaway
The combination of (a) a **field** deployment, (b) **voice**, (c) the **commute/driving** context, (d) LLM **structuring of one's own spoken thought** into a persistent board, and (e) an explicit design stance on **what to offload versus keep** is, as far as these searches show, unstudied. Each component has precedents. Together they let Souffleur speak to an open question in both literatures: is offloading *holding* to an LLM benign or beneficial when offloading *thinking* is harmful?

### Cited Findings
- The GenAI harm evidence comes almost entirely from **generation and reasoning** tasks in the lab or classroom: [Kosmyna 2025](https://arxiv.org/abs/2506.08872); [Fan 2025](https://doi.org/10.1111/bjet.13544); [Stadler 2024](https://opus.bibliothek.uni-augsburg.de/opus4/frontdoor/index/index/docId/114673); [Bastani 2025](https://doi.org/10.1073/pnas.2422633122); [Melumad & Yun 2025](https://doi.org/10.1093/pnasnexus/pgaf316); [Shen & Tamkin 2026](https://arxiv.org/abs/2601.20245). Knowledge-work evidence is a self-report survey ([Lee 2025](https://doi.org/10.1145/3706598.3713778)) or cross-sectional ([Gerlich 2025](https://doi.org/10.3390/soc15010006); [Si et al. 2026](https://doi.org/10.3390/jintelligence14070116)).
- 2026 definitions of problematic AI offloading target reasoning, ideas, learning and communication, not memory or tracking: [PAUSE 2026](https://arxiv.org/abs/2609.13155).
- Intention offloading is effective, but much less is known about it than about brain-based prospective memory: [Gilbert et al. 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC9971128/). It has a learning cost when support is withdrawn: [Fellers & Storm 2026](https://www.psypost.org/relying-on-reminders-could-be-weakening-your-memory-skills/).
- Capture systems fail at retrieval and use, not at capture: [Sellen & Whittaker 2010](https://www.microsoft.com/en-us/research/?p=159460); [Kalnikaité & Whittaker 2007](https://talks.cam.ac.uk/talk/index/8325/).
- Voice plus LLM writing tools have been studied at the desk or in bed, rarely on the move: [Rambler in the Wild 2025](https://arxiv.org/abs/2502.05612). In-car speech productivity has been studied in a simulator: [Martelaro et al. 2019](https://www.microsoft.com/en-us/research/?p=569166).
- Thought-partner work is text-based and recent: [Zhang et al. 2026](https://arxiv.org/abs/2609.01588); [Drosos et al. 2025](https://arxiv.org/abs/2501.17247).
- AI-authored goals reduce ownership and follow-through: [Chi et al. 2026](https://arxiv.org/abs/2605.12344).
- Commute prospection has measured benefits: [Jachimowicz et al. 2021](https://www.repository.cam.ac.uk/handle/1810/302690). Drivers mind-wander about two-thirds of the time on familiar roads: [Burdett et al. 2019](https://researchcommons.waikato.ac.nz/handle/10289/12097).

### Inferences
Candidate contribution claims, each worded to match what a 6-participant, 4-week formative study can support:

1. **Empirical separation of offloading types in the wild.** A field account of what users actually offload to a voice partner (intentions, reminders, open loops versus reasoning and drafting requests), and how that mix changes over weeks. The literature has lab evidence on each type separately, never both in one naturalistic deployment.
2. **Ecological validity for intention offloading with an LLM intermediary.** Gilbert et al. (2023) note how little is known about intention offloading. Souffleur adds the LLM *re-wording* step. Ownership and follow-through of LLM-extracted tasks can be examined descriptively in the logs, in light of Chi et al. (2026).
3. **The return path: do captured items come back?** Revisit and completion data for voice-captured items. HCI critiques have long called for this (Sellen & Whittaker; Bellotti), but there is almost no LLM-era data.
4. **The commute as a thinking context.** The first (to my search's knowledge) in-the-wild account of thinking aloud with an LLM voice agent on real commutes. It sits between mind-wandering research (Burdett), role-transition research (Jachimowicz) and in-car speech productivity (Martelaro; Strayer).
5. **Design knowledge on where "holding-relief" slides into "thinking-relief".** Identify the moments, such as agenda offers, drafts, macros and summaries, where the boundary blurs. Relate them to cognitive surrender (Shaw & Nave), metacognitive laziness (Fan) and the provocation and questioning countermeasures (Drosos; Danry).
6. **A measurement proposal.** A paired relief-plus-preservation outcome set (Q5) that later confirmatory studies could adopt.

**Things to avoid claiming:**
- That offloading holding is cost-free (contradicted by Fellers & Storm 2026 and Grinschgl 2021).
- That Zeigarnik's memory effect drives open-loop burden (contradicted by Ghibellini & Meier 2025).
- That reduced workload shows thinking was preserved (contradicted by Stadler 2024).
- Any effect size from a formative N of about 6 with one dominant heavy user.

### Gaps
- Searches covered Google-indexed sources and did not query the ACM DL directly. There may be CUI, IMWUT or AutoUI 2024–2026 papers on in-car LLM assistants or voice journaling that these searches missed. A targeted ACM DL search ("in-vehicle LLM", "AutomotiveUI conversational agent", "voice journaling") is recommended before claiming novelty.
- I could not confirm whether any 2026 study has already directly compared memory offloading with reasoning offloading to an LLM. Claim 1 should be worded "to our knowledge".
