# Voice thinking partners, reflection agents, and in-car voice/LLM interaction: prior work to position "Souffleur" against

Compiled 13 Oct 2026. Tags: **[PR]** = peer-reviewed; **[Preprint]** = arXiv or not yet peer-reviewed; **[Foundational]** = older than 2023, included because later work builds on it; **[Non-academic]** = industry, press or product source; **[Unverified]** = I could not confirm the paper's existence or details in this session. Every entry gives authors, year, title, venue, link, finding, and one line ("Implication") on what it means for framing Souffleur. Souffleur in short: thinking aloud during a real commute, LLM extraction to a board reviewed later at a desk, a live agent that talks back (answers, drafts, proactive offers, questions), and macro proposals. Early field results: users could not tell during silences whether the agent was still working; one heavy user, most users only used it a few times.

---

## 1. Which recent systems use speech as a medium for externalising and structuring thought, and what did their evaluations find?

### Takeaway
Since 2024 a cluster of CHI systems (Rambler, Orality, PointAloud, Memoro) has turned rambling speech into structured artefacts (gists, node-link canvases, anchored notes, memories) using LLMs. All but one were evaluated in short lab sessions with a screen in view and users sitting down. The one in-the-wild diary study found that even a mobile speech-writing tool was mostly used sitting at a desk or in bed. No system to date has studied speech-based thought externalisation where the user cannot look at the structure while speaking and reviews it only later.

### Cited Findings
- **[PR] Li, W., Tian, J., & Liu, C. (2026). "Orality: A Semantic Canvas for Externalizing and Clarifying Thoughts with Speech." CHI '26, Barcelona.** DOI [10.1145/3772318.3791713](https://doi.org/10.1145/3772318.3791713); [arXiv 2603.02544](https://arxiv.org/html/2603.02544v1).
  - System: LLM (GPT-5) extracts content from continuous speech into a node-link canvas grouped by topic. Users can restructure it by voice (merge, split, reorganise). On request it generates "Ask me questions" prompts and "Show me conflicts" logical-conflict detection.
  - Study: within-subjects lab study, N=12, 20-minute thought-clarification tasks, compared with ChatGPT plus dictation.
  - Results: self-rated clarity gain did not differ significantly (Orality M=1.83 vs baseline M=1.67). 8 of 12 preferred Orality for thinking support. NASA-TLX did not differ.
  - The on-demand "Ask me questions" feature was rated highest. Participants said it "helped unblock thoughts when unsure what to say." Conflict detection got mixed reactions because users were unsure what counted as a conflict.
  - Three usage styles emerged: "Master Commanders" (5), "Hands-On Mapmakers" (4) and "Lazy Talkers" (3).
  - Limitations the authors name: lab setting, too many nodes for some users, inconsistent LLM output — [Orality](https://arxiv.org/html/2603.02544v1).
  - *Implication:* This is the closest system to Souffleur, and Souffleur should be framed as its eyes-busy, in-the-wild, longitudinal counterpart. In Orality the canvas is visible while speaking and questions come only when the user asks; Souffleur has no screen during capture, reviews later, and sometimes asks unprompted.
- **[PR] Lin, S. et al. (2024). "Rambler: Supporting Writing With Speech via LLM-Assisted Gist Manipulation." CHI '24, Honolulu.** [arXiv 2401.10838](https://www.arxiv.org/pdf/2401.10838).
  - Rambler extracts gists (keywords and summaries) as anchors for working with dictated text. LLM-assisted "macro revisions" let users respeak, split, merge and transform the text — [search summary of Rambler / CityU record](https://scholars.cityu.edu.hk/en/publications/rambler-supporting-writing-with-speech-via-llm-assisted-gist-mani/).
  - Note a citation conflict: Orality's reference list gives Rambler's venue as "CSCW" ([Orality](https://arxiv.org/html/2603.02544v1)), but Rambler in the Wild cites it as CHI 2024 ([Yang et al. 2025](https://arxiv.org/html/2502.05612v1)). CHI 2024 appears correct.
  - *Implication:* This is the canonical "rambling to structure" precedent. Souffleur's topic, task and note extraction belongs to the same line, but the output goes to a workspace to act on later rather than to a written draft.
- **[PR] Yang, X., Li, W., Lee, M. G., Li, Z., Zamfirescu-Pereira, J. D., & Liu, C. (2025). "Rambler in the Wild: A Diary Study of LLM-Assisted Writing With Speech." CHI EA '25.** DOI [10.1145/3706599.3706676](https://doi.org/10.1145/3706599.3706676); [arXiv 2502.05612](https://arxiv.org/html/2502.05612v1).
  - Study: 4 focus groups plus a 7–10-day diary study with 12 writers.
  - 56.8% of writing was done on mobile phones, but mostly while stationary (desks, beds). Walking contributed only occasionally.
  - Writers of personal reflection "spoke a big chunk ... at the beginning" and restructured afterwards.
  - Speech-dependent composition caused distraction during ideation. 3 of 12 had reservations about sustained adoption — [Yang et al.](https://arxiv.org/html/2502.05612v1).
  - *Implication:* This is direct evidence that speech-thinking tools drift back to stationary use. Souffleur's commute deployment covers the mobile, eyes-busy case that is missing, and the adoption doubts foreshadow Souffleur's skewed usage (one heavy user, most users light).
- **[PR] Gmeiner, F., Thompson, J., Fitzmaurice, G., & Matejka, J. (2026). "PointAloud: An Interaction Suite for AI-Supported Pointer-Centric Think-Aloud Computing." CHI '26.** [arXiv 2602.09296](https://arxiv.org/html/2602.09296v1).
  - The authors name three problems with earlier think-aloud capture: users "lack awareness of what is captured by the system," are "not effectively encouraged to speak," and "miss or are interrupted by system feedback."
  - PointAloud's responses: TalkPointer gives low-distraction real-time feedback on capture next to the pointer. LLM-clustered TalkNotes are anchored in the canvas. TalkTips offers short proactive suggestions — [PointAloud](https://arxiv.org/html/2602.09296v1).
  - *Implication:* Its "awareness of what is captured" problem is the visual-domain twin of Souffleur's "is it still working?" silence problem. Souffleur must solve it without a visual channel.
- **[PR, Foundational-recent] Krosnick, R., Anderson, F., Matejka, J., Oney, S., Lasecki, W. S., Grossman, T., & Fitzmaurice, G. (2021). "Think-Aloud Computing: Supporting Rich and Low-Effort Knowledge Capture." CHI '21.** DOI [10.1145/3411764.3445066](https://unpaywall.org/10.1145%2F3411764.3445066); [PDF](https://public.websites.umich.edu/~rkros/papers/Think-Aloud_Computing_CHI2021.pdf).
  - When encouraged to speak while working, people verbalised design intent, process, problems and to-do items.
  - Think-aloud captured more subtle design decisions than traditional documentation at similar perceived effort — [Krosnick et al. via Autodesk Research](https://research.autodesk.com/publications/think-aloud-computing-supporting-rich-and-low-effort-knowledge-capture).
  - *Implication:* This supports Souffleur's premise that spontaneous speech contains extractable tasks and notes. Krosnick's speech was tied to an on-screen task, whereas commute speech is unanchored.
- **[PR] Zulfikar, W. D., Chan, S., & Maes, P. (2024). "Memoro: Using Large Language Models to Realize a Concise Interface for Real-Time Memory Augmentation." CHI '24 (Honorable Mention).** [MIT DSpace](https://dspace.mit.edu/handle/1721.1/155181); [arXiv 2403.02135](https://arxiv.org/html/2403.02135v1).
  - Wearable audio memory assistant with an explicit "Query Mode" and a proactive "Queryless Mode."
  - With N=20 in a real-time conversation task, it reduced device interaction time and increased recall confidence while preserving conversational quality — [MIT Media Lab](https://www.media.mit.edu/publications/memoro-using-large-language-models-to-realize-a-concise-interface-for-real-time-memory-augmentation-1/).
  - *Implication:* This is a precedent for continuous audio capture plus LLM structuring plus proactive offers. It was tested in the lab on recall, not on generative thinking or over weeks.
- **[PR, via Orality's reference list; not independently re-verified] Related speech-to-canvas systems:**
  - Chandrasegaran et al. (2019), "TalkTraces," CHI.
  - Zhang et al. (2025), "LADICA: Language-Driven Interactive Conversation Mapping for Collaborative Ideation," CHI.
  - Chen et al. (2025), "MeetMap: Speech-to-Canvas Mapping for Real-Time Meeting Dialogue Visualization," CHI.
  - Source: [Orality references](https://arxiv.org/html/2603.02544v1).
  - *Implication:* These are group or meeting focused. Souffleur is solo self-talk, which separates it from the collaborative speech-mapping line.
- **[Preprint, authors not verified] "Leveraging LLMs for Design Ideation: An AI Tool to Assist Creativity" (ALIA; arXiv Dec 2025).** [arXiv 2512.00010](https://arxiv.org/pdf/2512.00010).
  - Speech-based LLM ideation agent for small groups. "Condition-based speech interaction proved to be less interruptive." ALIA-assisted ideas were rated higher — [search summary of arXiv 2512.00010](https://arxiv.org/abs/2512.00010v1).
  - *Implication:* This is weak but suggestive evidence that triggering speech by condition, rather than continuously, reduces interruption, which bears on the design of Souffleur's proactive offers.
- **[Non-academic] Columbia Business School Insights, "Why speaking AI may be better for brainstorming" (CAiSEY).**
  - Reports that voice interactions with an AI debate partner were associated with "significantly higher divergent ideation." Spoken exchanges were more verbose and repetitive, and this redundancy was described as functional for maintaining coherence — [Columbia Business School](https://business.columbia.edu/insights/why-speaking-ai-may-be-better-brainstorming-CAiSEY).
  - *Implication:* Use only as motivating colour. Cite the underlying paper if one can be found.
- **[PR workshop position paper] Kim, J., Laban, P., Chen, X. A., & Arnold, K. C. (2025). "Voice Interaction With Conversational AI Could Facilitate Thoughtful Reflection and Substantive Revision in Writing." In2Writing Workshop @ NAACL 2025.** [arXiv 2504.08687](https://arxiv.org/abs/2504.08687v1).
  - Proposes a formative text-vs-voice study and reports no empirical results. It argues that voice "can naturally facilitate this conversational exchange ... and reduce cognitive load" — [arXiv 2504.08687](https://arxiv.org/abs/2504.08687v1).
  - *Implication:* The claim that voice is better for reflection is still largely a hypothesis, so Souffleur's field data can speak to it.

### Inferences
- The 2024–2026 speech-to-structure literature shares four traits: a visible canvas during speech, user-initiated AI help (Orality's questions and conflict detection are buttons), lab sessions of 20–60 minutes, and seated users. Souffleur breaks all four: no screen during capture, agent-initiated turns, multi-week use, and a moving vehicle.
- Orality's "Lazy Talkers" (3/12) and Rambler in the Wild's stationary drift suggest that many people use these tools as a dictation sink rather than an interactive partner. Souffleur's "most users used it a few times" pattern may be the field version of that segment.
- Capture uncertainty recurs across these papers. PointAloud names "awareness of what is captured" as a core problem in a visual setting; Souffleur meets it in an audio-only setting.

### Gaps
- I found no peer-reviewed study of an LLM **voice journaling** system where entries are spoken rather than typed. MindScape, MindfulDiary and ExploreSelf (Section 2) are text-based. One search summary claimed a "significant positive effect on insight in the audio condition" of LLM reflective conversations, but I could not trace it to a verifiable primary source (possibly a Utrecht MSc thesis: [studenttheses.uu.nl](https://studenttheses.uu.nl/handle/20.500.12932/48580)), so treat it as unverified.
- I found no peer-reviewed study of LLM-assisted thinking aloud **while walking or driving** with deferred desk review. Commercial products exist (e.g., a "voice-first thinking companion" that replies only when the user says "OK Answer": [App Store listing](https://apps.apple.com/us/app/id6744032623)) but are unevaluated.
- Full author lists for Rambler (CHI '24) and ALIA were not verified. Check them in the ACM DL before citing.

---

## 2. What do studies of LLM conversational agents for reflection or self-explanation say about when questions help and when they intrude?

### Takeaway
Classic cognitive science gives the tension Souffleur faces:
- Pure thinking aloud does not change performance (level 1–2).
- Being asked to explain changes it. This often improves learning, as in self-explanation, but it can disrupt insight-type thinking (verbal overshadowing).

Recent LLM work generally favours asking over telling (Thinking Assistants, AI-framed questioning, the "provocateur" agenda). It also shows that user control over timing and depth matters (ExploreSelf, Orality's on-demand questions), and that proactive interjections cost disruption unless the agent's presence and reasoning are visible (Codellaborator). The available evidence suggests questions help when the user pulls them, when they come at natural breakpoints, and when they lead to useful content rather than a quiz. They intrude when they force premature wording of half-formed ideas.

### Cited Findings
**Foundational verbalisation and self-explanation work**
- **[Foundational, PR] Ericsson, K. A., & Simon, H. A. (1980). "Verbal Reports as Data." Psychological Review 87(3).** [PDF](https://www3.nd.edu/~ghaeffel/Ericsson&Simon(1980).pdf).
  - Level 1–2 verbalisation reports what is already being attended to and needs little extra processing. Level 3 (explaining, reporting motives, filtering) requires extra processing and can alter thinking — [summary of the levels](https://explore.psychsafety.com/n/ericsson-simon-1980.md).
  - *Implication:* This is Souffleur's core design tension. Free thinking aloud is roughly level 2; an agent asking "why?" pushes the user into level 3.
- **[Foundational, PR] Fox, M. C., Ericsson, K. A., & Best, R. (2011). "Do procedures for verbal reporting of thinking have to be reactive? A meta-analysis and recommendations for best reporting methods." Psychological Bulletin 137(2), 316.** DOI 10.1037/a0021663 ([APA supplement](https://supp.apa.org:443/psycarticles/supplemental/a0021663/a0021663_supp.html)).
  - 94 studies, about 3,500 participants. The pure think-aloud effect on performance was indistinguishable from zero (r = −.03).
  - Procedures requiring participants to describe or explain their thinking were significantly reactive and produced higher performance than silent controls — [search summary of meta-analysis](https://supp.apa.org:443/psycarticles/supplemental/a0021663/a0021663_supp.html).
  - *Implication:* Thinking aloud alone should not harm thinking. Explanation prompts change it, and not necessarily for the worse, so Souffleur's questions are an intervention to justify, not a neutral probe.
- **[Foundational, PR] Chi, M. T. H., de Leeuw, N., Chiu, M. H., & LaVancher, C. (1994). "Eliciting self-explanations improves understanding." Cognitive Science 18, 439–477.** [ASU record](https://education.asu.edu/lcl/publications/chi-m-t-h-de-leeuw-n-chiu-m-h-lavancher-c-1994-eliciting-self-explanations).
  - 14 students prompted to self-explain after each line of a text were compared with 10 controls who read it twice. The prompted group had greater learning gains, and high explainers all reached the correct mental model — [ASU record](https://education.asu.edu/lcl/publications/chi-m-t-h-de-leeuw-n-chiu-m-h-lavancher-c-1994-eliciting-self-explanations).
  - *Implication:* This is the "questions help" side of the tension, though the setting was comprehension of given material, not generating new ideas.
- **[Foundational, PR] Schooler, J. W., Ohlsson, S., & Brooks, K. (1993). "Thoughts Beyond Words: When Language Overshadows Insight." J. Experimental Psychology: General 122(2), 166.** [PDF](https://labs.psych.ucsb.edu/schooler/jonathan/sites/labs.psych.ucsb.edu.schooler.jonathan/files/pubs/schooler1993.pdf).
  - Interrupting problem solvers to verbalise their strategies reduced success on insight problems.
  - Concurrent non-directive verbalisation impaired insight but not non-insight problems, which the authors take as language disrupting non-reportable processes — [Wikipedia: verbal overshadowing, summarising the paper](https://en.wikipedia.org/wiki/Verbal_overshadowing); [paper](https://labs.psych.ucsb.edu/schooler/jonathan/sites/labs.psych.ucsb.edu.schooler.jonathan/files/pubs/schooler1993.pdf).
  - *Implication:* This is the strongest classic evidence that being asked to explain mid-thought can derail "forming" ideas. It is a useful citation for why Souffleur's questions might hurt early in a thought.

**Recent work on asking versus telling**
- **[PR] Danry, V., Pataranutaporn, P., Mao, Y., & Maes, P. (2023). "Don't Just Tell Me, Ask Me: AI Systems that Intelligently Frame Explanations as Questions Improve Human Logical Discernment Accuracy over Causal AI Explanations." CHI '23.** [MIT DSpace](https://dspace.mit.edu/handle/1721.1/150613).
  - N=204. AI-framed questioning significantly increased discernment of logically flawed statements compared with no feedback and with causal AI explanations — [MIT Media Lab](https://www-prod.media.mit.edu/publications/don-t-just-tell-me-ask-me-ai-systems-that-intelligently-frame-explanations-as-questions-improve-human-logical-discernment-accuracy/).
  - *Implication:* Asking beats telling for evaluating reasoning, but this was text-based, short, and about judging statements, not about producing ideas while doing something else.
- **[Preprint] Park, S., Subramonyam, H., & Kulkarni, C. (2023/2024). "Thinking Assistants: LLM-Based Conversational Assistants that Help Users Think By Asking rather than Answering." arXiv 2312.06024 (v4, Dec 2024).** [arXiv](https://arxiv.org/abs/2312.06024v4).
  - Lab N=80: an assistant that first probes with expert-informed reflection questions and then gives advice beat question-only, advice-only and no-assistant conditions.
  - In a deployment of 223 conversations, participants responded positively to about 65% of responses — [arXiv 2312.06024](https://arxiv.org/abs/2312.06024v4).
  - *Implication:* Questions alone are not enough; probe-then-deliver works better. That supports Souffleur pairing questions with concrete offers (drafts, agendas).
- **[PR, viewpoint] Sarkar, A. (2024). "AI Should Challenge, Not Obey." Communications of the ACM (Oct 2024).** [CACM](https://cacm.acm.org/opinion/ai-should-challenge-not-obey); [arXiv 2411.02263](https://arxiv.org/pdf/2411.02263).
  - Proposes AI as "provocateur" that critiques, offers counterarguments and asks questions rather than completing work — [arXiv 2411.02263](https://arxiv.org/html/2411.02263v1).
  - *Implication:* This is the normative frame Souffleur's question-asking mode belongs to. Souffleur can test it under real constraints.
- **[PR] Lee, H.-P., Sarkar, A., Tankelevitch, L., Drosos, I., Rintel, S., Banks, R., & Wilson, N. (2025). "The Impact of Generative AI on Critical Thinking: Self-Reported Reductions in Cognitive Effort and Confidence Effects From a Survey of Knowledge Workers." CHI '25.** [PDF](https://advait.org/files/lee_2025_ai_critical_thinking_survey.pdf).
  - 319 knowledge workers gave 936 examples. Higher confidence in GenAI was associated with less critical thinking; higher self-confidence with more.
  - GenAI shifts critical thinking toward verification, integration and "task stewardship" — [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1135061).
  - *Implication:* This motivates a partner that keeps the user doing the thinking (questions, capture) rather than one that hands over answers.
- **[PR, Best Paper] Tankelevitch, L., Kewenig, V., Simkute, A., Scott, A. E., Sarkar, A., Sellen, A., & Rintel, S. (2024). "The Metacognitive Demands and Opportunities of Generative AI." CHI '24.** [arXiv 2312.10893](https://arxiv.org/pdf/2312.10893).
  - GenAI imposes heavy metacognitive monitoring and control demands. The authors propose building metacognitive support into GenAI systems — [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1000449).
  - *Implication:* In a car, metacognitive bandwidth is scarce. The agent should reduce monitoring demands (e.g., "did it get that?") rather than add to them.
- **[PR, perspective] Collins, K. M., Sucholutsky, I., Bhatt, U., … Tenenbaum, J. B., & Griffiths, T. L. (2024). "Building machines that learn and think with people." Nature Human Behaviour 8(10).** DOI [10.1038/s41562-024-01991-9](https://ideas.repec.org/a/nat/nathum/v8y2024i10d10.1038_s41562-024-01991-9.html); [arXiv 2408.03943](https://arxiv.org/pdf/2408.03943).
  - Argues for AI "thought partners" rather than mere tools for thought, grounded in the science of collaborative cognition — [Turing Institute](https://www.turing.ac.uk/news/publications/building-machines-learn-and-think-people).
  - *Implication:* This is the high-level vision behind the "thinking partner" framing. Souffleur is an empirical, situated instance of it.

**LLM journaling and reflection systems**
- **[PR] Song, I., Park, S., Pendse, S. R., Schleider, J. L., De Choudhury, M., & Kim, Y.-H. (2025). "ExploreSelf: Fostering User-driven Exploration and Reflection on Personal Challenges with Adaptive Guidance by Large Language Models." CHI '25.** [arXiv 2409.09662](https://arxiv.org/abs/2409.09662).
  - N=19. Participants valued "the balance between guided support and freedom to control their reflective journey," which led to deeper engagement and insight — [arXiv 2409.09662](https://arxiv.org/abs/2409.09662).
  - *Implication:* User control over when and how deeply to be questioned is the key moderator. This argues for Souffleur's questions to be optional or user-pullable.
- **[PR] Kim, T., Bae, S., Kim, H. A., Lee, S.-W., Hong, H., Yang, C., & Kim, Y.-H. (2024). "MindfulDiary: Harnessing Large Language Model to Support Psychiatric Patients' Journaling." CHI '24.** [arXiv 2310.05231](https://arxiv.org/abs/2310.05231v2).
  - 4-week field study with 28 patients with major depressive disorder and 5 psychiatrists. Conversational prompts helped patients keep more detailed daily records — [arXiv 2310.05231](https://arxiv.org/abs/2310.05231v2).
  - *Implication:* This is a field precedent for LLM journaling that prompts with questions, but it is text-based and clinical.
- **[PR] Nepal, S. et al. (2024). "MindScape Study: Integrating LLM and Behavioral Sensing for Personalized AI-Driven Journaling Experiences." IMWUT 2024.** [arXiv 2409.09570](https://arxiv.org/abs/2409.09570v1); [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11634059).
  - LLM journaling prompts driven by sensed context (sleep, location, conversation). 8-week study, N=20 students.
  - Reported 7% higher positive affect, 11% lower negative affect, 6% lower loneliness, and a weekly PHQ-4 decrease (coefficient −0.25) — [MindScape search summary / MIT DSpace](https://dspace.mit.edu/entities/publication/37e8e5c1-7db1-4088-8a30-a616f1c51570).
  - *Implication:* This is the IMWUT precedent for context-aware, proactive reflection prompts over weeks. Souffleur adds speech and driving as the context.
- **[Foundational, PR] Kocielnik, R., Xiao, L., Avrahami, D., & Hsieh, G. (2018). "Reflection Companion: A Conversational System for Engaging Users in Reflection on Physical Activity." IMWUT 2(2).** DOI [10.1145/3214273](https://unpaywall.org/10.1145%2F3214273); [PDF](https://faculty.washington.edu/garyhs/docs/kocielnik-UBICOMP2018-reflection.pdf).
  - 25 adaptive mini-dialogues were built from 275 workshop-generated reflection questions. In a 2-week deployment with 33 Fitbit users they triggered reflection and increased motivation, empowerment and adoption of new behaviours — [search summary of IMWUT paper](https://faculty.washington.edu/garyhs/docs/kocielnik-UBICOMP2018-reflection.pdf).
  - *Implication:* This is the pre-LLM IMWUT ancestor of agent-initiated reflection questions.
- **[Foundational, PR] Kocielnik, R., Avrahami, D., Marlow, J., Lu, D., & Hsieh, G. (2018). "Designing for Workplace Reflection: A Chat and Voice-Based Conversational Agent." DIS '18, 881–894.**
  - Explored workplace self-reflection with an agent available in both chat and voice, reporting user preferences and trade-offs between modalities — [citation listing](https://prosocial.owlstown.net/publications/100). Detailed findings were not retrieved in this session.
  - *Implication:* This is the most direct pre-LLM comparison of voice and text reflection agents. Read it before claiming novelty for voice reflection.
- **[PR, IMWUT] Bentvelzen, M., Woźniak, P. W., Herbes, P. S. F., Stefanidi, E., & Niess, J. (2022). "Revisiting Reflection in HCI: Four Design Resources for Technologies that Support Reflection." IMWUT 6(1).** DOI [10.1145/3517233](https://api.crossref.org/works/10.1145%2F3517233).
  - Four design resources for reflection technologies: temporal perspective, conversation, comparison, discovery — [Chalmers record](https://research.chalmers.se/en/publication/529987).
  - *Implication:* This gives a ready IMWUT vocabulary. Souffleur combines conversation (the live agent) with a temporal perspective (desk review later).

**Proactivity and interruption**
- **[PR] Pu, K., Lazaro, D., Arawjo, I., Xia, H., Xiao, Z., Grossman, T., & Chen, Y. (2025). "Assistance or Disruption? Exploring and Evaluating the Design and Trade-offs of Proactive AI Programming Support." CHI '25.** [arXiv 2502.18658](https://arxiv.org/abs/2502.18658v3).
  - N=18. Proactive agents increased efficiency over prompt-only use but "incur workflow disruptions."
  - Presence indicators and interaction context reduced the disruption and "improved users' awareness of AI processes" — [arXiv 2502.18658](https://arxiv.org/pdf/2502.18658).
  - *Implication:* Proactive offers need visible or audible agent presence. This links proactivity to Souffleur's silence problem.
- **[Preprint; venue not verified] Abbas, A., Wohn, C., Jagtap, A., Rho, E. H., Kim, Y.-H., & Lee, S. W. (2025). "'Having Lunch Now': Understanding How Users Engage with a Proactive Agent for Daily Planning and Self-Reflection." arXiv 2509.24073.** [arXiv](https://arxiv.org/abs/2509.24073).
  - 14-day study, N=12, with a proactive coaching agent. Users accepted, negotiated or resisted its check-ins.
  - "Rigidity, premature turn-taking, and overpromising" caused resistance and disengagement — [arXiv 2509.24073](https://arxiv.org/abs/2509.24073).
  - *Implication:* This is a close longitudinal analogue to Souffleur's proactive offers. "Premature turn-taking" is the same failure as cutting off a forming thought.
- **[PR] Martelaro, Teevan & Iqbal (2019)** (details in Section 3): a speech assistant that asked structured questions while drivers composed documents.
  - One participant: "The more structured sections where I was prompted to enter the next step in a process felt too constrained and made me spend extra time thinking about how to word my idea to fit the prompt." The authors conclude that "support that inhibited their flow of thought" was worse and that preferences differ between people — [Martelaro et al. 2019 PDF](https://microsoft.com/en-us/research/uploads/prod/2019/02/productivity-in-the-car.pdf).
  - *Implication:* This is direct in-car evidence for the Ericsson & Simon level-3 concern. Cite it next to Schooler.

### Inferences
- Taken together, the evidence suggests three conditions under which questions help:
  - the user can call for them (Orality's top-rated feature was on-demand questions; ExploreSelf's user control);
  - they come before or after a burst of generation rather than inside it (Schooler; Martelaro's "flow of thought");
  - they lead to tangible value (Thinking Assistants' probe-then-advise; Codellaborator's context).
- Questions intrude when they demand level-3 explanation of an idea still forming, arrive by fixed script, or cut off a pause ("premature turn-taking").
- No study tests the timing of agent questions within a spoken monologue (at a pause, at a topic boundary, or at the end of a drive). Souffleur's logs (pause durations, topic boundaries, user reactions to offers) can address this directly.
- The reflection-agent literature is dominated by wellbeing and clinical framings (MindfulDiary, MindScape, ExploreSelf). Souffleur's work and project thinking framing is less studied; the closest are SwitchBot and Thinking Assistants.

### Gaps
- No peer-reviewed study compares spoken versus typed reflection with an LLM agent on reflection depth. The In2Writing paper only proposes one, and Kocielnik DIS '18 predates LLMs (findings not retrieved).
- No direct test of Chi-style self-explanation prompts versus Schooler-style overshadowing in generative, non-learning thinking with an AI partner was found.
- A "PaceMind" LLM-mediated journaling paper (two-week within-subjects study) surfaced in a search snippet ([PolyU repository](https://ira.lib.polyu.edu.hk/handle/10397/117729?mode=full)) but could not be verified. **[Unverified]**

---

## 3. What does research say about voice assistants and LLM agents in the car: proactive in-car assistants, commute productivity, the commute as transition time, and safety?

### Takeaway
1. The closest prior study is Martelaro, Teevan & Iqbal (CHI 2019): simulator only, 28 Microsoft employees, speech-based productivity while driving. Driving held up but situation awareness dropped, and structured prompts disrupted thinking.
2. LLM in-car work from 2024–2026 is booming. On-road DRT data put Gemini Live conversations at about hands-free-phone cognitive load (preprint), simulator studies report stable driving with ChatGPT agents (preprint), and CHI '26 papers address proactive in-vehicle conversational assistants and fatigue.
3. Proactivity research converges on low-complexity, suggestive prompts with user confirmation.
4. Organisational behaviour work shows the commute matters as a role-transition window: thinking ahead about work buffers long commutes.
5. Classic distraction work (Strayer and colleagues) shows that hands-free is not risk-free, especially for composing and for systems with poor recognition.

None of these studies is a multi-week naturalistic deployment of an LLM thinking partner on real commutes.

### Cited Findings
**Commute productivity and transition**
- **[PR, Foundational] Martelaro, N., Teevan, J., & Iqbal, S. T. (2019). "An Exploration of Speech-Based Productivity Support in the Car." CHI '19.** DOI [10.1145/3290605.3300494](https://doi.org/10.1145/3290605.3300494); [PDF](https://microsoft.com/en-us/research/uploads/prod/2019/02/productivity-in-the-car.pdf).
  - Design: simulator, 28 Microsoft employees (14 writing, 14 slide creation), 7 sessions including driving-only, thinking-aloud-only, driving plus talking, and 4 support × road-context-alert combinations.
  - Driving: the productivity tasks "did not critically change" driving. Drivers compensated with larger headway and less lane deviation, and brake reaction times did not differ.
  - Safety: road-sign recognition (situation awareness) was significantly lower in every dual-task condition than in driving-only. For the presentation task, driving plus talking (M=5.3) and low-context/low-support (M=4.5) were rated significantly less safe than driving-only (M=6.28).
  - Preferences were split (writing: 8 high support, 2 low, 3 none; presentation: 4/4/6), and many felt document creation was too hard for real roads.
  - One participant: "If I could do nothing more than talk and organize my thoughts in an 'outline' ... that would be really useful." The authors suggest outline-oriented tasks and ramp-up/ramp-down tasks — [PDF](https://microsoft.com/en-us/research/uploads/prod/2019/02/productivity-in-the-car.pdf).
  - *Implication:* This is the key antecedent. Souffleur realises its suggested design (talk freely, get an outline later) with LLMs and moves from simulator to real commutes over weeks.
- **[Working paper / journal; see note] Teodorovicz, T., Kun, A. L., Sadun, R., & Shaer, O. (2022). "Multitasking while driving: a time use study of commuting knowledge workers to access current and future uses." LSE CEP Discussion Paper 1841** ([LSE](https://researchonline.lse.ac.uk/id/eprint/117830)). Also reported as published in the International Journal of Human-Computer Studies ([HBS Working Knowledge](https://hbswk.hbs.edu/item/when-the-rubber-meets-the-road-most-commuters-text-and-email-while-driving)); journal details not verified here.
  - 400 commuting knowledge workers. Work multitasking was more common in the morning, personal multitasking on the way home.
  - Share of multitasking events: 18% reading emails, 9.5% replying to emails, 7.5% calls, 7% "thinking of work," 7% "planning for events" — [HBS Working Knowledge](https://hbswk.hbs.edu/item/when-the-rubber-meets-the-road-most-commuters-text-and-email-while-driving).
  - *Implication:* Commuters already think and plan about work while driving, and also do riskier things like email. Souffleur can be framed as making existing commute thinking safer and more useful.
- **[PR] Jachimowicz, J. M., Lee, J. J., Staats, B. R., Menges, J. I., & Gino, F. (2021). "Between Home and Work: Commuting as an Opportunity for Role Transitions." Organization Science 32(1), 64–85.** [IDEAS/RePEc](https://ideas.repec.org/a/inm/ororsc/v32y2021i1p64-85.html).
  - Three field studies (n=1,736), including a 4-week intervention. "Role-clarifying prospection" (thinking about the upcoming work role) reduced the negative effects of long morning commutes on job satisfaction and turnover intentions — [summary](https://academicnewsletter.sufe.edu.cn/info/374159).
  - *Implication:* This is theoretical grounding for Souffleur's "agenda for the drive" offers. Morning commute thinking can be a deliberate transition practice.
- **[PR] Williams, A., Kaur, H., Mark, G., Thompson, A. L., Iqbal, S. T., & Teevan, J. (2018). "Supporting Workplace Detachment and Reattachment with Conversational Intelligence." CHI '18.** DOI [10.1145/3173574.3173662](https://www.microsoft.com/en-us/research/?p=465405).
  - SwitchBot held structured start- and end-of-day dialogues. In a 14-day study with 34 information workers, users sent fewer after-hours emails and spent more of their first hour in productivity apps.
  - Gains were better sustained when conversations focused on work-related emotions — [MSR page](https://www.microsoft.com/en-us/research/?p=465405).
  - *Implication:* This is the Microsoft precedent for a conversational agent at transitions. Souffleur moves the transition dialogue into the commute itself and makes it spoken.
- **[Non-academic, unverified figure]** Press coverage attributes to Microsoft research a "12–15% increase in productivity" from using commute time to reflect, cited by Satya Nadella — [Fortune](https://dc.fortune.com/2023/02/02/remote-work-why-do-i-miss-commuting-psychological-detach-recovery-liminal-space-management-study/). The primary source was not found. Do not cite this figure without tracing it.

**LLM in-vehicle conversational agents (2024–2026)**
- **[Preprint] Monk, C., Ayala, A., Yu, C. S. P., Fitch, G. M., & Gruber, D. (2026). "Visual and Cognitive Demands of a Large Language Model-Powered In-vehicle Conversational Agent." arXiv 2601.15034.** [arXiv](https://arxiv.org/abs/2601.15034v1).
  - On-road study, N=32, comparing Gemini Live (single- and multi-turn) with hands-free phone calls, visual turn-by-turn guidance and the OSPAN task.
  - Gemini Live and phone calls had similar cognitive load (Detection Response Task), between turn-by-turn and OSPAN. Load stayed stable across extended multi-turn conversations.
  - Mean glance durations stayed well under the 2-second threshold, and drivers reported low effort and distraction — [arXiv 2601.15034](https://arxiv.org/html/2601.15034v1).
  - *Implication:* This is the most recent on-road safety baseline for LLM voice conversation. It supports the claim that an LLM voice partner is roughly phone-call level, not a new distraction class. Note its likely industry provenance (Gemini Live) and preprint status.
- **[Preprint, submitted to IJHCS] Bond, Y. L., Choe, M., Hasan, B. K., Siddiqui, A., & Jeon, M. (2025). "ChatGPT on the Road: Leveraging Large Language Model-Powered In-vehicle Conversational Agents for Safer and More Enjoyable Driving Experience." arXiv 2508.08101.** [arXiv](https://arxiv.org/abs/2508.08101).
  - Motion-base simulator, within-subjects N=40, comparing no agent, a pre-scripted agent, and a ChatGPT agent.
  - The ChatGPT agent gave lower variability in longitudinal and lateral acceleration and lane deviation, and was rated higher on competence, animacy, affective trust and preference — [arXiv 2508.08101](https://arxiv.org/abs/2508.08101).
  - *Implication:* This supports the safety and acceptability of free-form LLM talk while driving, though only in a simulator over a single session.
- **[PR] Cockram, L., Yu, Y., Pardo, J., Li, X., Rakotonirainy, A., Kuo, J., Demmel, S., Lenné, M., & Schroeter, R. (2026). "Small Talk, Big Impact? LLM-based Conversational Agents to Mitigate Passive Fatigue in Conditional Automated Driving." CHI '26.** [arXiv 2510.25421](https://arxiv.org/abs/2510.25421v1).
  - Test-track study, N=40, in rural automated driving. The LLM agent checked in on drivers and was found "helpful for supporting vigilance during passive fatigue."
  - Three distinct user profiles differed in acceptance, calling for "adaptive design sensitive to diverse user groups" — [arXiv 2510.25421](https://arxiv.org/abs/2510.25421v1).
  - A search summary also attributes to this line of work that some drivers found conversation too shallow (underload) while others found it effortful or intrusive (overload). This was not verified in the paper text.
  - *Implication:* Engagement can raise alertness, which is a possible safety argument for a thinking partner on monotonous commutes. User heterogeneity matches Souffleur's skewed usage.
- **[PR, Foundational] Large, D. R., Burnett, G., Antrobus, V., & Skrypchuk, L. (2018). "Driven to discussion: engaging drivers in conversation with a digital assistant as a countermeasure to passive task-related fatigue."** [Nottingham repository](https://nottingham-repository.worktribe.com/output/949701/driven-to-discussion-engaging-drivers-in-conversation-with-a-digital-assistant-as-a-countermeasure-to-passive-task-related-fatigue). Journal believed to be IET Intelligent Transport Systems; not verified here.
  - Wizard-of-Oz study, 20 participants, 30-minute drives. Conversation with the "Vid" assistant improved lane-keeping and hazard response, increased pupil diameter and spread of attention, and raised self-reported alertness — [repository summary](https://nottingham-repository.worktribe.com/output/949701).
  - *Implication:* Conversation can be protective under underload, which counters the assumption that talking while driving is always a cost.

**Proactive in-vehicle assistants**
- **[PR] Du, H., Feng, X., Ma, J., Wang, M., Tao, S., Zhong, Y., Li, Y.-F., & Wang, H. (2024). "Towards Proactive Interactions for In-Vehicle Conversational Assistants Utilizing Large Language Models." IJCAI 2024.** [IJCAI proceedings](https://www.ijcai.org/proceedings/2024/869); [arXiv 2403.09135](https://arxiv.org/abs/2403.09135).
  - Proposes five proactivity levels along two dimensions (assumption × autonomy). With N=40, "the proactive level with strong assumptions and user confirmation is most appropriate" — [arXiv](https://arxiv.org/abs/2403.09135).
  - *Implication:* This supports Souffleur's "offer" pattern: propose concretely, then wait for the user to confirm.
- **[PR] Susak, J., Liu, Y., Jansen, P., & Colley, M. (2026). "ProVoice: Designing Proactive Functionality for In-Vehicle Conversational Assistants using Multi-Objective Bayesian Optimization to Enhance Driver Experience." CHI '26.** [arXiv 2601.19421](https://arxiv.org/abs/2601.19421v1).
  - VR driving simulator, within-subjects N=19. Multi-objective Bayesian optimisation over intervention designs found trade-offs that reduced mental demand while improving predictability and usefulness — [arXiv](https://arxiv.org/html/2601.19421v1).
  - *Implication:* Predictability is a first-class goal for proactive agents in the car and is directly relevant to unexplained agent silences.
- **[PR] Meck, A.-M., Draxler, C., & Vogt, T. (2024). "How May I Interrupt? Linguistic-Driven Design Guidelines for Proactive In-Car Voice Assistants." International Journal of Human–Computer Interaction.** [figshare](https://figshare.com/articles/journal_contribution/How_May_I_Interrupt_Linguistic-Driven_Design_Guidelines_for_Proactive_in-Car_Voice_Assistants/24313978).
  - German driving-simulator study. Proactive prompts work best with low linguistic complexity and a suggestive tone — [search summary](https://edoc.ub.uni-muenchen.de/33564/).
  - *Implication:* This gives concrete phrasing guidance for Souffleur's offers and questions.
- **[PR, Foundational] Schmidt, M. et al. (2020). "How Users React to Proactive Voice Assistant Behavior While Driving." LREC 2020.** [ACL Anthology](https://aclanthology.org/2020.lrec-1.61/). Findings not retrieved in this session.
  - *Implication:* This is a pre-LLM proactive in-car baseline to cite for continuity.
- **[PR, Foundational] Kim, S., Chun, J., & Dey, A. K. (2015). "Sensors Know When to Interrupt You in the Car: Detecting Driver Interruptibility Through Monitoring of Peripheral Interactions." CHI '15.** [dblp](https://dblp1.uni-trier.de/rec/conf/chi/KimCD15.html).
  - With 15 drivers, a classifier on wearable and OBD sensor data predicted interruptibility every second with 94% accuracy — [search summary](https://hcii.cmu.edu/news/chi-research-makes-waves-media).
  - *Implication:* Timing proactive turns to driving demand is feasible. Souffleur's offers currently ignore driving context, which is a design limitation to acknowledge.
- **[PR, Foundational] Janssen, C. P., Iqbal, S. T., Kun, A. L., & Donker, S. F. (2019). "Interrupted by my car? Implications of interruption and interleaving research for automated vehicles." IJHCS 130, 221–233.** [Utrecht record](https://utrecht-main-test.atmire.com/items/2e8b9bb2-3471-4977-bb38-117ee20f9597).
  - Frames handovers between car and driver as interruption handling in ten stages — [search summary](https://par.nsf.gov/servlets/purl/10111515).
  - *Implication:* This is a theoretical lens for when an agent's offer interrupts a driver who is also thinking.

**Safety and cognitive distraction**
- **[PR, Foundational] Strayer, D. L., Cooper, J. M., Turrill, J., Coleman, J. R., & Hopman, R. J. (2017). "The Smartphone and the Driver's Cognitive Workload: A Comparison of Apple, Google, and Microsoft's Intelligent Personal Assistants." Canadian Journal of Experimental Psychology 71(2), 93–110.** [TRID](https://trid.trb.org/View/1373185).
  - Compared cognitive workload of Siri, Google Now and Cortana while driving; the original AAA report was 2015 — [TRID](https://trid.trb.org/view.aspx?id=1373185).
  - *Implication:* This is the canonical citation that voice interaction is not workload-free.
- **[Technical report, Foundational] Cooper, J. M., Ingebretsen, H., & Strayer, D. L. (2014). "Mental Workload of Common Voice-Based Vehicle Interactions across Six Different Vehicle Systems." AAA Foundation for Traffic Safety.** [AAA Foundation](https://aaafoundation.org/mental-workload-common-voice-based-vehicle-interactions-across-six-different-vehicle-systems/).
  - Low-accuracy voice systems produced high (category 3) distraction. Composing texts or emails (category 3) was more distracting than listening (category 2).
  - Systems ranged from 1.7 (Toyota Entune) to 3.7 (Chevrolet MyLink) — [AAA newsroom](https://newsroom.aaa.com/2014/10/imperfect-hands-free-systems-causing-potentially-unsafe-driver-distractions/).
  - *Implication:* Speech recognition errors and composition are the riskiest parts. Souffleur's design of capturing now and editing later at the desk avoids composing in the car, a safety argument worth making explicit.

### Inferences
- The car literature splits into four camps that do not talk to each other:
  1. safety and workload (Strayer, Monk);
  2. proactive in-vehicle conversational assistant design (Du, Meck, ProVoice);
  3. fatigue countermeasures (Large, Cockram);
  4. commute productivity and transition (Martelaro, Teevan/Iqbal, Teodorovicz, Jachimowicz).

  Souffleur sits at the junction of the first and fourth and borrows from the second.
- Most LLM in-car studies are single-session, scripted, simulator or test-track, and focused on infotainment or companionship. None that I found studies **work thinking** on the user's own commute over weeks.
- Martelaro's two findings—that drivers wanted "talk and organize my thoughts" and that structured prompts were disruptive—are essentially Souffleur's design brief. The paper should cite it prominently as the question Souffleur takes forward.
- The fatigue literature offers a counter-intuitive safety framing: cognitively engaging talk may help under the low arousal of monotonous commutes. This should be framed cautiously, since Souffleur did not measure driving.

### Gaps
- No naturalistic (own vehicle, own commute, multi-week) study of an LLM voice agent was found. Monk et al. is on-road but uses scripted tasks.
- No study measured the safety cost of open-ended thinking aloud, as opposed to scripted tasks, with an LLM partner on the road.
- The 12–15% Microsoft commute productivity figure has no primary source located.
- Full findings of Schmidt et al. (LREC 2020) and the journal details for Large et al. (2018) and Teodorovicz et al. (IJHCS) were not verified.

---

## 4. What is known about silence, turn-taking, latency, backchannels and progress feedback in spoken conversational agents?

### Takeaway
Spoken agents get turn-taking wrong in both directions. They interrupt pauses and they leave unexplained silences. Benchmarks and user studies from 2024–2026 (Talking Turns, Full-Duplex-Bench) show current systems often do not know when to speak, interrupt too aggressively, and rarely backchannel. HCI work shows that unexplained "non-answers" stall interaction, that natural verbal fillers improve perceived latency where generic wait indicators do not, and that showing agent presence reduces disruption from proactive agents. For a thinking-aloud user the problem has two sides: the agent must tolerate long thinking pauses without taking a turn, yet still signal that it is listening or working. That combination is largely unstudied.

### Cited Findings
- **[PR, Foundational] Skantze, G. (2021). "Turn-taking in Conversational Systems and Human-Robot Interaction: A Review." Computer Speech & Language 67.** Cited in [Skantze et al. 2025, arXiv 2501.08946](https://arxiv.org/html/2501.08946v1). DOI not verified here.
  - *Implication:* This is the standard reference for turn-taking cues and end-of-turn prediction. Cite it as background.
- **[PR] Arora, S., Lu, Z., Chiu, C.-C., Pang, R., & Watanabe, S. (2025). "Talking Turns: Benchmarking Audio Foundation Models on Turn-Taking Dynamics." ICLR 2025.** [arXiv 2503.01174](https://arxiv.org/abs/2503.01174v1); [ICLR](https://iclr.cc/virtual/2025/poster/31129).
  - The first comprehensive user study of turn-taking in spoken dialogue systems found that they "sometimes do not understand when to speak up, can interrupt too aggressively and rarely backchannel" — [arXiv](https://arxiv.org/pdf/2503.01174).
  - *Implication:* State-of-the-art evidence that turn-taking failures are systemic. Souffleur's silence confusion is an expected, field-observed case of them.
- **[Preprint, technical report] Défossez, A., Mazaré, L., Orsini, M., Royer, A., Pérez, P., Jégou, H., Grave, E., & Zeghidour, N. (2024). "Moshi: a speech-text foundation model for real-time dialogue." arXiv 2410.00037.** [arXiv](https://arxiv.org/html/2410.00037v1).
  - Described as the first real-time full-duplex spoken LLM: about 160 ms theoretical and 200 ms practical latency, with parallel streams for user and system speech — [arXiv](https://arxiv.org/abs/2410.00037v1).
  - *Implication:* Full duplex makes backchannels and overlap technically possible. A thinking partner may still want a deliberately listening, low-talk stance, which is a design question rather than a capability question.
- **[Preprint] "Full-Duplex-Bench-v2: A Multi-Turn Evaluation Framework for Duplex Dialogue Systems with an Automated Examiner" (2025).** [arXiv 2510.07838](https://arxiv.org/html/2510.07838v1).
  - Describes Full-Duplex-Bench (v1) as the first benchmark for streaming interaction covering pause handling, turn-taking, backchanneling and user interruptions — [search summary](https://arxiv.org/html/2510.07838v1).
  - *Implication:* "Pause handling" is now an evaluation category, so Souffleur can link its field silences to it.
- **[Preprint] "Speculative End-Turn Detector for Efficient Speech Chatbot Assistant" (2025).** [arXiv 2503.23439](https://arxiv.org/pdf/2503.23439).
  - Assistants often mistake thinking pauses for end of turn and give premature, off-target responses; pause duration alone cannot separate hesitation from completion — [search summary](https://arxiv.org/pdf/2503.23439).
  - *Implication:* Thinking aloud has long, frequent within-turn pauses, the worst case for end-of-turn detection.
- **[PR] Maslych, M., Katebi, M., Lee, C., Hmaiti, Y., Ghasemaghaei, A., Pumarada, C., Palmer, J., Segarra Martinez, E., Emporio, M., Snipes, W., McMahan, R. P., & LaViola Jr, J. J. (2025). "Mitigating Response Delays in Free-Form Conversations with LLM-powered Intelligent Virtual Agents." CUI '25.** [arXiv 2507.22352](https://arxiv.org/abs/2507.22352v1).
  - Natural conversational fillers (verbal plus gesture) significantly improved perceived response time at medium (~4.0 s) and high (~6.5 s) latency, but did not offset broader user-experience costs.
  - Artificial wait indicators (loading icons, sounds) did not differ from no filler. Latency above about 4 s degraded quality of experience — [arXiv HTML](https://arxiv.org/html/2507.22352v1).
  - *Implication:* Earcons or "thinking" beeps may not fix Souffleur's silence problem. Verbal acknowledgements ("Got it, drafting that now") may work better, though this was tested in VR, not in a car.
- **[PR, Foundational] Fischer, J. E., Reeves, S., Porcheron, M., & Sikveland, R. O. (2019). "Progressivity for Voice Interface Design." CUI '19.** DOI [10.1145/3342775.3342788](https://nottingham-repository.worktribe.com/output/2248081).
  - Drawing on conversation analysis, non-answer responses impede progress, while giving an account for a non-answer can enable recovery — [emcawiki summary](https://emcawiki.net/Fischer2019).
  - *Implication:* Unexplained silence is the most extreme non-answer. Souffleur should account for its delays ("still working on the draft").
- **[PR, Foundational] Porcheron, M., Fischer, J. E., Reeves, S., & Sharples, S. (2018). "Voice Interfaces in Everyday Life." CHI '18.** DOI [10.1145/3173574.3174214](https://eprints.nottingham.ac.uk/49153).
  - Month-long Echo deployments analysed with conversation analysis. Voice interaction is embedded in other ongoing activity, which raises issues of the accountability of interface responses — [Nottingham repository](https://nottingham-repository.worktribe.com/output/927340/voice-interfaces-in-everyday-life).
  - *Implication:* Use it to frame driving as the "ongoing activity" in which voice turns must fit.
- **[PR, Foundational] Luger, E., & Sellen, A. (2016). "'Like Having a Really Bad PA': The Gulf between User Expectation and Experience of Conversational Agents." CHI '16.** [MSR](https://microsoft.com/en-us/research/?p=285179).
  - Interviews with 14 users found expectations badly out of step with system capability, analysed through Norman's gulfs of execution and evaluation — [search summary](https://results2021.ref.ac.uk/outputs/a740b86f-7a33-49b4-b8be-98d4e2e13fbe?page=1).
  - *Implication:* Not knowing whether the agent is still working is a textbook gulf of evaluation. Use this framing.
- **[PR] Pu et al. (2025), Codellaborator** (see Section 2). Presence indicators improved users' awareness of AI processes and reduced disruption — [arXiv](https://arxiv.org/pdf/2502.18658).
- **[PR] Gmeiner et al. (2026), PointAloud** (see Section 1). Users lacked awareness of what was being captured, so the system added low-distraction real-time capture feedback — [arXiv](https://arxiv.org/html/2602.09296v1).
- **[Preprint] Abbas et al. (2025)** (see Section 2). "Premature turn-taking" was a main source of disengagement from a proactive agent — [arXiv](https://arxiv.org/abs/2509.24073).
- **[Non-academic] Industry practice and claims:**
  - Voice-agent vendors describe users reading silences of about 1–1.5 s as uncertainty ("Is anyone still there?"), and wondering whether the line dropped or the agent stopped listening. These posts cite cross-linguistic gap data (Dutch about 199 ms, English about 242 ms) and a 2024 pause-perception study — [Deepgram blog](https://deepgram.com/learn/voice-ai-latency-why-pauses-read-as-hesitation). The primary studies were not verified.
  - LLM-based "incomplete turn" filters that hold the agent's reply while the user is mid-thought are now a framework feature — [Pipecat docs](https://docs.pipecat.ai/server/utilities/turn-management/filter-incomplete-turns).
  - *Implication:* Practitioners know about the problem, but academic user studies in the thinking-aloud context are missing.

### Inferences
- The research mostly assumes a **request–response** setting where silence means latency. In Souffleur, silence has several meanings: the user is thinking, the agent is listening, the agent is working on a long task (a draft), or the system has failed. The user cannot tell which, and has no screen to check. This "ambiguous silence" framing appears new.
- Evidence suggests verbal, accountable acknowledgements beat abstract signals (Maslych; Fischer et al.). In a car, though, every agent utterance costs attention, so status signalling is a trade-off between uncertainty and workload. A study could position this as an open design tension.
- End-of-turn detection work is tuned to pause lengths in task-oriented dialogue. Thinking-aloud monologues likely have very different pause statistics, and Souffleur's field logs could document them.

### Gaps
- I found no user study of the **perception of agent silence in an eyes-busy context** such as driving, or of status signals (earcons, verbal acknowledgements, haptics) for long-running LLM tasks during driving.
- No peer-reviewed study was found on backchannels from an AI listener during **solo** thinking aloud, i.e. whether "mm-hm" from an agent helps or disturbs.
- Primary sources for the industry claims (1.5 s threshold, pause-perception study) were not verified.

---

## 5. What gaps could a longitudinal in-the-wild study of a commute-time voice thinking partner claim?

### Takeaway
Across the four literatures above, the empirical base is almost entirely lab, simulator, test-track or short diary studies. Most systems give AI help only on request and assume a visible interface. Long-term voice-assistant use is known to decay, and LLM-era in-the-wild evidence is thin. A multi-week deployment on real commutes of an LLM partner that captures, structures, offers and asks, with desk review afterwards, can make several defensible novelty claims, provided it frames the low and uneven usage as a finding rather than a failure.

### Cited Findings
- **Study durations in the closest prior work:**
  - Orality: 20-minute lab sessions, N=12 — [Orality](https://arxiv.org/html/2603.02544v1).
  - Martelaro et al.: one simulator session, N=28 — [PDF](https://microsoft.com/en-us/research/uploads/prod/2019/02/productivity-in-the-car.pdf).
  - Monk et al.: on-road but with scripted tasks — [arXiv](https://arxiv.org/abs/2601.15034v1).
  - Cockram et al.: test track — [arXiv](https://arxiv.org/abs/2510.25421v1).
  - Bond et al.: simulator — [arXiv](https://arxiv.org/abs/2508.08101).
  - Rambler in the Wild: 7–10 days, mostly stationary use — [Yang et al.](https://arxiv.org/html/2502.05612v1).
- **Longitudinal reflection and agent deployments exist outside the car:**
  - SwitchBot: 14 days — [Williams et al.](https://www.microsoft.com/en-us/research/?p=465405).
  - Reflection Companion: 2 weeks — [Kocielnik et al.](https://faculty.washington.edu/garyhs/docs/kocielnik-UBICOMP2018-reflection.pdf).
  - MindScape: 8 weeks — [Nepal et al.](https://dspace.mit.edu/entities/publication/37e8e5c1-7db1-4088-8a30-a616f1c51570).
  - MindfulDiary: 4 weeks — [Kim et al.](https://arxiv.org/abs/2310.05231v2).
  - "Having Lunch Now": 14 days — [Abbas et al.](https://arxiv.org/abs/2509.24073).

  None is voice-first while driving.
- **[PR, Foundational] Cho, M., Lee, S.-S., & Lee, K.-P. (2019). "Once a Kind Friend is Now a Thing: Understanding How Conversational Agents at Home are Forgotten." DIS '19.**
  - Documents how home conversational agents are gradually abandoned over time. A web search confirmed the authors, title and venue, but I retrieved no direct DOI or PDF link and did not read the paper. The nearest result was [arXiv 2408.16465](https://arxiv.org/pdf/2408.16465), which is a different paper. Get the DOI from the ACM DL before citing.
  - *Implication:* Abandonment and novelty decay are known for voice agents. Souffleur's "few uses for most, one heavy user" should be analysed against this, e.g. who sustains use and why, rather than reported as a deficit.
- **Recent large-scale LLM log analysis** ("Adopt ≠ Adapt," [alphaXiv 2605.29018](https://www.alphaxiv.org/abs/2605.29018v1); **[Preprint]**) of about 12,000 Bing Copilot users found weak individual trends: "user habits proving to be overwhelmingly sticky," and more active users had more successful and more professional conversations — [search summary](https://www.alphaxiv.org/abs/2605.29018v1).
  - *Implication:* Heavy-user skew is normal for LLM tools. A case study of the heavy user is defensible, especially paired with what kept others away.

### Inferences
Candidate gap claims, each with supporting citations:
1. **First multi-week, naturalistic deployment of an LLM voice thinking partner during real car commutes.** Prior work is simulator or single session (Martelaro 2019; Bond 2025), on-road but scripted (Monk 2026), test track (Cockram 2026), or seated lab work (Orality 2026; PointAloud 2026).
2. **Eyes-free capture with deferred visual sensemaking.** Orality, Rambler and PointAloud assume a co-present canvas. Souffleur separates speaking (car) from structuring and review (desk), which raises open questions about trust in extraction, re-finding thoughts and the value of the board as a later "transition" artefact (cf. Jachimowicz's role-clarifying prospection; SwitchBot's reattachment).
3. **Field evidence on the verbalisation tension.** Classic work predicts that thinking aloud is harmless but forced explanation is reactive, helping (Chi) or hurting insight (Schooler). Martelaro's participants felt that prompts which interrupted their flow were harmful. No study has observed in the field when users accept or reject an AI's questions mid-monologue. Souffleur's logs of offers and questions with accept or ignore outcomes can provide that.
4. **Ambiguous silence as a new turn-taking problem.** The turn-taking literature (Talking Turns; Full-Duplex-Bench; Maslych CUI '25; Fischer CUI '19) treats silence as latency. Souffleur shows that in thinking-aloud partnership silence is ambiguous (user thinking, agent listening, agent working, or failure), and that drivers cannot resolve it visually. This is a concrete, field-grounded design problem.
5. **Proactive offers in a thinking context rather than an infotainment context.** In-car proactivity work (Du 2024, Meck 2024, ProVoice 2026) concerns navigation, comfort and alerts. Souffleur studies proactive cognitive offers (agenda, drafts, macros), which connects in-car proactivity to the "AI should challenge" and Thinking Assistants agenda.
6. **Adoption heterogeneity as a finding.** Cockram 2026 found three distinct user profiles, Martelaro 2019 found split preferences, and Orality's "Lazy Talkers" form a usage segment. Souffleur's skew (one heavy user) can be framed as evidence that commute thinking partners suit particular cognitive styles or work types. A formative study should articulate these profiles.

Framing cautions:
- Souffleur did not measure driving safety, so any safety claim must rest on cited work (Monk; Strayer; Cooper). Position "capture now, compose at the desk" as consistent with evidence that composing is the most distracting voice task (Cooper et al. 2014).
- With most users using it only a few times, claims about longitudinal change are limited. Frame them as formative and descriptive (IMWUT accepts this when design implications are strong).

### Gaps
- I did not find any 2025–2026 IMWUT paper specifically on LLM voice agents during commutes. A targeted ACM DL search of IMWUT 2025–2026 issues is advisable before claiming "first."
- Kocielnik et al. DIS '18 (voice vs chat reflection agent at work) and Cho et al. DIS '19 should be read in full. The first is the closest pre-LLM precedent for voice reflection and could weaken a "first voice reflection agent" claim.
- Not verified here and worth checking for overlap:
  - IMWUT or UbiComp papers on in-car voice notes, dictation or lifelogging;
  - 2025–2026 AutoUI papers on LLM assistants for knowledge work in automated vehicles;
  - commercial "thinking-aloud" voice apps with published evaluations.
