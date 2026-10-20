# Human-AI interaction guidelines for proactive, voice-only agents (timing, trust calibration, transparency without a screen)

Notes compiled 13 Oct 2026 for the Souffleur formative field study (IMWUT / CHI-adjacent framing). Souffleur: car-commute, think-aloud voice partner; LLM builds a desk-side board; live voice agent makes proactive "offers" and proposes "macros".

Labels used: **[PR]** peer-reviewed; **[Preprint]** arXiv/not yet peer-reviewed; **[Found.]** foundational (pre-2023); **[Std]** standard/regulatory; **[Industry]** company guidance. Every DOI/arXiv ID below was checked against Crossref, Semantic Scholar, arXiv or the ACL Anthology in this session. Where I give a finding from memory because the abstract could not be fetched, the entry says **(abstract not retrieved; verify wording)**.

---

## Q1. Who has applied or extended Amershi et al.'s guidelines to voice, conversational and LLM agents, and what do they say about voice?

### Takeaway
The 18 guidelines were explicitly *least* applicable to voice assistants in their own validation study. The authors flagged that GUI-less (voice) systems and semi-autonomous vehicles may need "additional" or "specialized" guidelines. Since then, the main updates for generative AI (Weisz et al. CHI 2024; Microsoft's agent-communication challenges, 2024; Google PAIR v2, 2021) say almost nothing about voice or proactivity. A 2025 IUI workshop states outright that Amershi et al. "only lightly touch on proactive behavior". No published set of guidelines covers voice-only, eyes-busy, proactive LLM partners. That gap is open for Souffleur to claim.

### Cited Findings

**Original guidelines and their voice-specific evidence**
- **Amershi, Weld, Vorvoreanu, Fourney, Nushi, Collisson, Suh, Iqbal, Bennett, Inkpen, Teevan, Kikin-Gil, Horvitz (2019). "Guidelines for Human-AI Interaction." CHI '19. [PR, Found.]** https://doi.org/10.1145/3290605.3300233
  - Finding: 49 practitioners tested 18 guidelines against 20 products. "Voice assistants had the largest number of 'does not apply' instances reported." Voice assistants, photo organizers and activity trackers had the fewest applications or violations, which the authors attribute to "a mode of operation or input data type beyond simple graphical user interfaces and text" — [paper PDF, Microsoft Research](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
  - In the Discussion they write: "some guidelines do not directly apply to AI systems that lack graphical user interfaces (e.g., voice-based virtual assistants…). Additional guidelines may be necessary…". They add that "specialized guidelines may be required in certain high-risk or highly regulated areas such as semi-autonomous vehicles" — [same PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
  - G2 ("how well"), G11 ("why") and G17 ("global controls") were singled out as guidelines that, "despite their importance, are still not widely implemented" (largest negative application−violation difference). These are the same guidelines Souffleur's audit rated weak — [same PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
  - Voice-assistant examples from the paper's appendix:
    - G1 violation: "When [the assistant] was invoked verbally… I was not given any indication of what commands I could request."
    - G2 violation: "Aside from the 'Hi, how can I help?', [the product] does not promise anything more. No expectation of quality is set."
    - G3 (time services) violation: "There is no indication of when [the assistant] will actually remind you."
    - G8 application: "I can say 'nevermind' to dismiss it… I can also just not say anything and it stops listening."
    - G10 application: "If I didn't respond or if I spoke quietly, [the assistant] let me know they had trouble hearing me."
    - G9 application: "Once my request for a reminder was processed I saw the ability to edit my reminder **in the UI that was displayed**… 'Tap to Edit'." Here the voice product met G9 by falling back to a screen — [same PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
  - Implication: The authors themselves say the guidelines fit voice poorly and that vehicles may need their own. Souffleur's audit can therefore be framed as an empirical answer to that call, not as a gap the authors overlooked. The "Tap to Edit" G9 example is a 2019 precedent for "deferred guideline satisfaction" (meeting a guideline on a screen instead of in speech).

**Follow-ups on the guidelines themselves**
- **Li, Vorvoreanu, DeBellis, Amershi (2022/2023). "Assessing Human-AI Interaction Early through Factorial Surveys: A Study on the Guidelines for Human-AI Interaction." ACM TOCHI. [PR]** https://doi.org/10.1145/3511605
  - Finding: Uses factorial surveys (guideline applied vs violated × optimal vs sub-optimal AI performance) to estimate each guideline's UX impact. It is a protocol for prioritising guidelines before building — [Semantic Scholar abstract](https://doi.org/10.1145/3511605)
  - Implication: This is a ready-made method Souffleur could reuse in a follow-up: e.g., a vignette survey comparing "one-clause spoken G11 now" with "desk-form G11 later" under good and bad AI performance.
- **Hong, Fourney, DeBellis, Amershi (2021). "Planning for Natural Language Failures with the AI Playbook." CHI '21. [PR]** https://doi.org/10.1145/3411764.3445735
  - Finding: Interviews with 12 natural-language practitioners showed that prototyping often skipped failure scenarios. The HAX "AI Playbook" was built to get teams to plan for NL errors systematically.
  - Implication: Souffleur's failure modes (ASR errors while driving, an offer that misreads the topic) can be catalogued in the same way. HAX already has a tool that is NL-specific, though not voice- or proactivity-specific.
- **Kocielnik, Amershi, Bennett (2019). "Will You Accept an Imperfect AI? Exploring Designs for Adjusting End-user Expectations of AI Systems." CHI '19. [PR, Found.]** https://doi.org/10.1145/3290605.3300641
  - Finding: Two systems had the same 50% accuracy but were tuned to avoid different error types (false positives vs false negatives). They produced "vastly different" perceived accuracy and acceptance. Expectation-adjustment techniques raised acceptance significantly.
  - Implication: G1/G2 for Souffleur is about setting expectations, which could be done once at onboarding or on the board rather than in every spoken turn. Error-type choice also matters: an offer when none was needed (false positive) is probably costlier for a driver than a missed offer.
- **Yang, Steinfeld, Rosé, Zimmerman (2020). "Re-examining Whether, Why, and How Human-AI Interaction Is Uniquely Difficult to Design." CHI '20. [PR, Found.]** https://doi.org/10.1145/3313831.3376301
  - Finding: AI design is hard for two reasons: uncertainty about the AI's capabilities, and the complexity of its outputs. The paper defines four levels of AI systems.
  - Implication: An LLM voice partner sits at the most complex level (adaptive, open-ended output), which is part of why the guidelines strain.

**Generative-AI and agent-era updates**
- **Weisz, He, Muller, Hoefer, Miles, Geyer (2024). "Design Principles for Generative AI Applications." CHI '24. [PR]** https://doi.org/10.1145/3613904.3642466 (arXiv: https://arxiv.org/abs/2401.14484)
  - Finding: Six principles: Design Responsibly; Design for Generative Variability; Design for Mental Models; Design for Co-Creation; Design for Appropriate Trust & Reliance; Design for Imperfection.
  - Trust strategies: "calibrate trust using explanations", "provide rationales for outputs", "use friction to avoid overreliance", "signify the role of the AI". Imperfection strategies include "make uncertainty visible".
  - The paper does not discuss voice/speech or unprompted (proactive) behaviour beyond a footnote on other input modalities — [arXiv HTML](https://arxiv.org/html/2401.14484)
  - Implication: "Make uncertainty *visible*" and "friction" are framed visually. Souffleur can argue that these strategies need an audio translation (prosody, hedges, an explicit "check this at your desk") and a timing translation (friction is unsafe while driving, so it is deferred to the desk).
  - Also: Weisz, He, Muller (2025/2026), "Human-Centered AI Design Principles for Generative AI", chapter in *Handbook of Human-Centered AI* (Springer), https://doi.org/10.1007/978-981-97-8440-0_74-1 [PR chapter; content not read].
- **Bansal, Vaughan, Amershi, Horvitz, Fourney, Mozannar, Dibia, Weld (2024). "Challenges in Human-Agent Communication." arXiv 2412.10380. [Preprint, Microsoft Research]** https://arxiv.org/abs/2412.10380
  - Finding: Twelve challenges in three groups:
    - Agent→user: A1 "What can the agent do?", A2 "What is the agent about to do?", A3 "What is the agent currently doing?", A4 "Were there any side effects…?", A5 "Was the goal achieved?"
    - User→agent: U1 goals, U2 preferences, U3 "What should the agent do differently next time?"
    - Overarching: X1 verification, X2 consistency, X3 "appropriate level of detail", X4 "which past interactions"
  - The paper does not discuss voice — [arXiv HTML](https://arxiv.org/html/2412.10380)
  - Implication: This is the closest "Amershi update for agents" from the same group. A3 maps directly onto the field finding that participants could not tell whether Souffleur was still working during silences. X3 (level of detail) is the theoretical home for "one-clause now, desk form later". U3 is the home for "a declined offer must not come back".
- **Google PAIR, People + AI Guidebook v2 ("Published May 8, 2019. Updated May 18, 2021"). [Industry]** https://pair.withgoogle.com/guidebook-v2/
  - Finding: Pattern categories include "How do I help users build and calibrate trust…", "How do I explain my AI system…" and "balance of user control and automation". The homepage shows no generative-AI-specific or voice-specific patterns — [PAIR guidebook](https://pair.withgoogle.com/guidebook-v2/)
  - Implication: The major industry guidebook has not been updated for voice or proactive LLM agents (as far as the public site shows).
- **Microsoft HAX Toolkit. [Industry]** https://www.microsoft.com/en-us/haxtoolkit/about/
  - Finding: Built around the 18 guidelines plus Workbook, Design Patterns and Playbook. A search found no public 2024–2026 revision of the 18 guidelines for generative AI or agents — [Microsoft blog](https://blogs.microsoft.com/ai-for-business/hax-toolkit/)
  - Implication: The 2019 list remains the reference point, which justifies auditing against it, while Bansal et al. (2024) supplies the agent-era extensions.

**Voice/CUI-specific heuristics (do not extend Amershi, but are the voice counterpart)**
- **Murad, Munteanu, Cowan, Clark (2019). "Revolution or Evolution? Speech Interaction and HCI Design Guidelines." IEEE Pervasive Computing. [PR, Found.]** https://doi.org/10.1109/mprv.2019.2906991
  - Finding: Existing guidelines and heuristics are "heavily oriented towards GUI interaction". VUI heuristics should be built in evolutionary steps from GUI principles.
  - Implication: Supports a "translate each guideline into a spoken form plus a desk form" approach rather than inventing a new list.
- **Langevin, Lordon, Avrahami, Cowan, Hirsch, Hsieh (2021). "Heuristic Evaluation of Conversational Agents." CHI '21. [PR]** https://doi.org/10.1145/3411764.3445312
  - Finding: Nielsen-derived CA heuristics, validated on a chatbot and a voice assistant, found more usability issues than Nielsen's originals (dialogue content, interaction design, help and guidance, human-like characteristics, data privacy).
  - Implication: A complementary instrument. It is not AI-specific and not proactive-specific.
- **Kraus, Zepf, Westhäußer, Feustel, Zargham, Aslan, Edwards, Mayer, Kontogiorgos, Wagner, André (2025). "BEHAVE AI: BEst Practices and Guidelines for Human-Centric Design and EvAluation of ProactiVE AI Agents." IUI '25 Companion (workshop). [PR workshop proposal]** https://doi.org/10.1145/3708557.3716155
  - Finding: "The guidelines for the design of human-AI interaction, such as those by Amershi et al., only lightly touch on proactive behavior." SUS and UEQ "have been validated only in the context of reactive systems." The paper summarises Yorke-Smith et al.'s (2012) principles for proactive agents: "valuable, pertinent, competent, controllable, transparent, deferent, unobtrusive, anticipatory, and safe" — [PDF](https://sven-mayer.com/wp-content/uploads/2026/03/kraus2025behave.pdf)
  - Implication: A direct, citable statement of the gap Souffleur addresses. "Deferent" and "unobtrusive" match the advisor's "offer, never assign" constraint.
- **Yorke-Smith, Saadati, Myers, Morley (2012). "The Design of a Proactive Personal Agent for Task Management." Int. J. on AI Tools 21(1). [PR, Found.]** https://doi.org/10.1142/s0218213012500042
  - Finding: Source of the nine proactive-assistance principles listed above (as summarised in BEHAVE AI).
  - Implication: A pre-LLM principle set specifically about proactivity, useful alongside Amershi.

### Inferences
- Amershi's own data supports the claim that "the guidelines were written for screens". Voice products drew the most "does not apply" responses, and the one voice G9 success relied on a displayed UI. Souffleur's "deferred guideline satisfaction" can be presented as making that implicit fallback deliberate and time-shifted (car → desk).
- The weak guidelines in Souffleur's audit (G2, G11, G17) are the same three Amershi et al. found to be under-implemented across all products in 2019. Their weakness in Souffleur is partly a general industry pattern and partly sharpened by voice.
- No generative-AI update (Weisz 2024; PAIR v2; HAX) addresses voice or proactivity. Bansal et al. (2024) addresses agents but not voice. A paper that tests what each guideline means with no screen and with attention elsewhere has clear novelty.

### Gaps
- I found no peer-reviewed study that systematically audits Alexa, Google Assistant or an LLM voice agent against all 18 Amershi guidelines (2023–2026). Searches returned only CA heuristics papers. This may exist in non-indexed theses or industry reports.
- I could not confirm any official 2024–2026 Microsoft revision of the 18 guidelines for generative AI.
- I could not fetch the current pair.withgoogle.com/guidebook landing page to see whether a v3 or generative-AI chapter exists beyond v2 (May 2021).
- Wright et al. (2020), "A Comparative Analysis of Industry Human-AI Interaction Guidelines" (arXiv), was not verified this session and is left out.

---

## Q2. Proactive conversational agents: when and how to intervene, and how people feel about being prompted by an AI

### Takeaway
Studies agree on four points:
1. Proactivity is valued mainly for urgent or safety-relevant matters, and is otherwise double-edged: the "proactivity dilemma".
2. Conservative forms (notify or suggest, and ask rather than assume) build more trust than autonomous action.
3. Timing at task boundaries or low-load moments matters as much as content.
4. Presence or "what I'm doing" cues reduce the disruption that proactive LLM agents cause.

In-car work (2019–2026) adds that drivers accept most well-timed suggestions, but whether the moment is right depends on rich context. In-car LLM proactivity is being studied now (CHI 2026, a 2026 preprint). I found almost no work on the memory side of proactivity: never re-offering what was declined.

### Cited Findings

**Foundational mixed-initiative and interruption research**
- **Horvitz (1999). "Principles of Mixed-Initiative User Interfaces." CHI '99. [PR, Found.]** https://doi.org/10.1145/302979.303030
  - Finding: Twelve principles. Among them: consider uncertainty about the user's goals; consider the status of the user's attention when timing services; infer the ideal action given costs, benefits and uncertainty; use dialogue to resolve key uncertainties; allow efficient direct invocation and termination; minimise the cost of poor guesses about action and timing; scope the precision of service to match uncertainty; keep a working memory of recent interactions; keep learning by observing **(principle wording from memory; abstract not retrieved; verify against PDF)**.
  - Implication: The decision-theoretic root of G3 (time services), G8 (dismissal) and G10 (scope when in doubt). "Minimise the cost of poor guesses" plus "learn by observing" is the formal basis for "a declined offer must not come back".
- **McFarlane (2002). "Comparison of Four Primary Methods for Coordinating the Interruption of People in HCI." Human–Computer Interaction 17(1). [PR, Found.]** https://doi.org/10.1207/s15327051hci1701_2
  - Finding: Compares immediate, negotiated, mediated and scheduled interruption **(abstract not retrieved; method names from memory)**.
  - Implication: Souffleur's "offer" is a *negotiated* interruption (the user decides whether to take it up). That is a principled position to state.
- **Adamczyk & Bailey (2004). "If not now, when? The effects of interruption at different moments within task execution." CHI '04. [PR, Found.]** https://doi.org/10.1145/985692.985727
  - Finding: Interrupting at different moments within a task had different effects on performance, emotional state and social attribution — [Semantic Scholar TLDR](https://doi.org/10.1145/985692.985727)
  - Implication: Offers should land at thought or topic boundaries, not mid-utterance.
- **Iqbal & Bailey (2008). "Effects of Intelligent Notification Management on Users and Their Tasks." CHI '08. [PR, Found.]** https://doi.org/10.1145/1357054.1357070 (and Iqbal & Bailey 2010, "Oasis", TOCHI, https://doi.org/10.1145/1879831.1879833)
  - Finding: A defer-to-breakpoint policy, driven by statistical models, reduced frustration and reaction time compared with immediate delivery — [Semantic Scholar TLDR](https://doi.org/10.1145/1357054.1357070)
  - Implication: Supports holding offers until a breakpoint in thinking or driving, e.g., a pause after the user finishes a topic or a stop at a light.
- **Mehrotra, Pejovic, Vermeulen, Hendley, Musolesi (2016). "My Phone and Me: Understanding People's Receptivity to Mobile Notifications." CHI '16. [PR, Found.]** https://doi.org/10.1145/2858036.2858566
  - Finding: Even notifications with important or useful content can disrupt. Psychological traits shape response time and perceived disruption — [Semantic Scholar TLDR](https://doi.org/10.1145/2858036.2858566)
  - Implication: Relevance alone does not justify an offer. There are individual differences, so G13 (learn from behaviour) should personalise how often offers come.

**Proactive voice assistants (CUI/CHI/IMWUT)**
- **Zargham, Reicherts, Bonfert, Voelkel, Schöning, Malaka, Rogers (2022). "Understanding Circumstances for Desirable Proactive Behaviour of Voice Assistants: The Proactivity Dilemma." CUI '22. [PR]** https://doi.org/10.1145/3543829.3543834
  - Finding: Storyboard interviews (N=15). Participants saw benefits for "urgent or critical issues" but worried about "interference with social activities…, potential loss of agency, and intrusiveness".
  - Implication: The canonical citation for the dilemma. The advisor's "you don't prompt me" is the loss-of-agency pole of it.
- **Reicherts, Zargham, Bonfert, Rogers, Malaka (2021). "May I Interrupt? Diverging Opinions on Proactive Smart Speakers." CUI '21. [PR]** https://doi.org/10.1145/3469595.3469629
  - Finding: Online survey of 8 proactive scenarios. Ratings were "surprisingly positive", with concerns about privacy, agency and "undesirable interference with ongoing (social) activities".
  - Implication: Attitudes are positive in the abstract and conditional in situ. Souffleur's field data can test that gap.
- **Reicherts, Rogers, Capra, Wood, Duong, Sebire (2022). "It's Good to Talk: A Comparison of Using Voice Versus Screen-Based Interactions for Agent-Assisted Tasks." ACM TOCHI 29(3). [PR]** https://doi.org/10.1145/3484221
  - Finding: Pairs did exploratory data analysis with a facilitator agent. Voice prompts produced more turn-taking, more questions, more interaction with the system and "more immediate, faster-paced discussions following agent prompts" than screen-based prompts.
  - Implication: Voice prompts *are* effective at steering thinking. That supports the power of Souffleur's offers, and also the need for restraint: a voice prompt is harder to ignore than a screen prompt.
- **Oh, Kim, Kim, Im, Lee (2024). "Better to Ask Than Assume: Proactive Voice Assistants' Communication Strategies That Respect User Agency in a Smart Home Environment." CHI '24. [PR]** https://doi.org/10.1145/3613904.3642193
  - Finding: A Wizard-of-Oz smart home study produced communication strategies that let proactive VAs act while preserving user agency. The title states the core result: asking is preferred to assuming.
  - Implication: The closest peer-reviewed support for "offer, never assign". Souffleur's offers are an "ask" strategy.
- **Kraus, Wagner, Minker (2020). "Effects of Proactive Dialogue Strategies on Human-Computer Trust." UMAP '20. [PR]** https://doi.org/10.1145/3340631.3394840
  - Finding: Varied proactivity (none / notification / suggestion / intervention) and timing (fixed vs insecurity-based) in a planning task. Proactivity was trusted in "insecure situations independent of the timing". "Fully autonomous system behaviour fails to establish an adequate human-computer trust relationship, in contrast to conservative strategies."
  - Implication: Empirical support for keeping Souffleur at the notification/suggestion levels. Offers are best when the user seems stuck or uncertain.
- **Kraus, Wagner, Callejas, Minker (2021). "The Role of Trust in Proactive Conversational Assistants." IEEE Access. [PR]** https://doi.org/10.1109/access.2021.3103893
  - Finding: Formalises proactive dialogue and shows that the effect of proactive actions on trust depends on user and situational characteristics.
  - Implication: Trust in offers is conditional on the user and the moment, which supports per-user adaptation.
- **Peng, Kwon, Lu, Wu, Ma (2019). "Design and Evaluation of Service Robot's Proactivity in Decision-Making Support Process." CHI '19. [PR, Found.]** https://doi.org/10.1145/3290605.3300328
  - Finding: N=36. "A highly proactive robot is deemed inappropriate". Medium proactivity "helps reduce the decision space while maintaining users' sense of engagement". Low proactivity grants control but may under-use the system's capability.
  - Implication: The trade-off for Souffleur's offer frequency: medium proactivity is the target.
- **Meurisch, Mihale-Wilson, Hawlitschek, Giger, Müller, Hinz, Mühlhäuser (2020). "Exploring User Expectations of Proactive AI Systems." Proc. ACM IMWUT 4(4). [PR, IMWUT]** https://doi.org/10.1145/3432193
  - Finding: In the wild, 3,168 in-situ responses from 272 participants. Expected proactivity levels depend on human factors and context, so systems should "preset to meet individual expectations".
  - Implication: An IMWUT precedent for in-situ study of proactivity expectations, and a methodological anchor for Souffleur's field study.
- **Tabassum, Kosiński, Frik, Malkin, Wijesekera, Egelman, Lipford (2019). "Investigating Users' Preferences and Expectations for Always-Listening Voice Assistants." Proc. ACM IMWUT 3(4). [PR, IMWUT]** https://doi.org/10.1145/3369807
  - Finding: N=178. People imagine mostly the same services as current wake-word VAs. Willingness to share a conversation depends on sensitivity, comfort and perceived benefit.
  - Implication: Souffleur listens continuously during a drive, so privacy-related global controls (G17) carry extra weight. Another IMWUT anchor.
- **Bérubé, Nißen, Vinay, … Kowatsch, Kocaballi (2024). "Proactive behavior in voice assistants: A systematic review and conceptual model." Computers in Human Behavior Reports 14, 100411. [PR]** https://doi.org/10.1016/j.chbr.2024.100411
  - Finding: Reviewed 21 studies and proposed a context → initiation → action model. "Suggestions were the primary action." Clear benefits appeared mainly "in safety-critical and emergency situations", with mixed results elsewhere. Most studies were domestic or in-vehicle — [UTS repository](https://opus.lib.uts.edu.au/handle/10453/180986)
  - Implication: The literature has not shown benefits of proactivity for non-urgent cognitive support. Souffleur's offers (agenda, recap) are exactly that under-evidenced category.
- **Kraus, Zepf, Leusmann, Zhang, Kuzminykh, Zargham (2026). "What Counts as Proactive? Rethinking Proactivity in Conversational Agents." CUI '26 (provocation). [PR]** https://doi.org/10.1145/3816046.3816303
  - Finding: Argues the term "proactivity" is "conceptually underspecified and inconsistently applied" (reminders and recommendations get labelled proactive). Proposes a principled definition and framework.
  - Implication: Souffleur should define precisely what it calls proactive: agent-initiated offers versus scheduled recaps triggered by re-entering a topic.
- **Marques, Abreu, Santos (2023). "Proactivity in the TV Context…" IMX '23. [PR]** https://doi.org/10.1145/3573381.3597219
  - Finding: Focus groups found proactive scenarios relevant if "some characteristics can be pre-configured regarding the type of communication and intrusion".
  - Implication: A global proactivity dial (G17) is a recurring user wish.
- **Edwards, Nguyen, Sobocinski, Lämsä, de Araujo, Dang, Whitehead, Roberts, et al. (2024). "MAI – A Proactive Speech Agent for Metacognitive Mediation in Collaborative Learning." CUI '24. [PR, short]** https://doi.org/10.1145/3640794.3665585
  - Finding: A rule-based proactive speech agent prompting metacognition. Piloted as Wizard-of-Oz and as a working NLP prototype, with ethical considerations discussed.
  - Implication: The nearest "proactive speech agent for thinking" precedent. It is group- and learning-focused, not a solo thinking partner.

**Proactive LLM agents (2024–2026)**
- **Liu, Fang, Shi, Wu, Igarashi, Chen (2025). "Proactive Conversational Agents with Inner Thoughts." CHI '25. [PR]** https://doi.org/10.1145/3706598.3713760
  - Finding: The agent keeps a covert "train of thoughts" and "seeks the right moment to contribute" based on intrinsic motivation. It beat baselines on turn-taking appropriateness, coherence and anthropomorphism.
  - Implication: An architecture for *when* to offer. Souffleur could log candidate offers it chose *not* to voice, which helps with transparency later at the desk.
- **Pu, Lazaro, Arawjo, Xia, Xiao, Grossman, Chen (2025). "Assistance or Disruption? Exploring and Evaluating the Design and Trade-offs of Proactive AI Programming Support." CHI '25. [PR]** https://doi.org/10.1145/3706598.3713357
  - Finding: Within-subjects study (N=18). Proactive agents increased efficiency over prompt-only but "incur workflow disruptions". "Presence indicators and interaction context support alleviated disruptions and improved users' awareness of AI processes." The authors note trade-offs with control, ownership and understanding.
  - Implication: Presence cues reduce disruption. This bears on Souffleur's "is it still working?" silences: an audio presence indicator is the voice analogue.
- **Chen, Zhu, Zhao, Mozannar, Sontag, Talwalkar (2025). "Need Help? Designing Proactive AI Assistants for Programming." CHI '25. [PR]** https://doi.org/10.1145/3706598.3714002
  - Finding: Lays out design considerations for proactive LLM assistants. A randomised experiment showed "significant benefits" with "important nuances" depending on design elements. Details beyond the abstract were not retrieved.
  - Implication: Proactivity works when a shared workspace grounds relevance. Souffleur's board is that shared workspace, but the user cannot see it while driving.
- **Lu, Yang, Qian, Chen, Luo, Wu, Wang, Cong, Zhang, Lin, Liu, Wang, Liu, Liu, Sun (2024). "Proactive Agent: Shifting LLM Agents from Reactive Responses to Active Assistance." arXiv 2410.12361. [Preprint; later venue not verified]** https://arxiv.org/abs/2410.12361
  - Finding: ProactiveBench has 6,790 events with human accept/reject labels. The best fine-tuned model reached an F1 of 66.47% at proactively offering help.
  - Implication: Even purpose-trained models misjudge about a third of offers. Declines will be common, so the design for declined offers (no return, learn from it) is central.
- **Deng, Liao, Lei, Yang, Lam, Chua (2025). "Proactive Conversational AI: A Comprehensive Survey…" ACM TOIS. [PR]** https://doi.org/10.1145/3715097
  - Finding: An NLP survey. Here proactivity means leading the conversation toward *system-side* goals. It flags LLM proactivity, evaluation protocols and ethics as open.
  - Implication: The NLP sense of proactivity (the system steers) runs against the advisor's constraint. Souffleur should distance itself explicitly from target-guided proactivity.
- **Kaur, Lyu, Shah (2026). "Knowing Isn't Understanding: Re-grounding Generative Proactivity with Epistemic and Behavioral Insight." ICML 2026 (position). [PR per arXiv comment]** https://arxiv.org/abs/2602.15259
  - Finding: Proactivity is an "epistemic necessity" when users face unknown unknowns, but "unconstrained proactive interventions can misdirect attention, overwhelm users". Agents need "behavioral grounding: principled constraints on when, how, and to what extent an agent should intervene."
  - Implication: The thinking-partner rationale for offers (surfacing what the user hasn't thought of), together with the requirement for constraints.
- **Liu, Karoui, Draxler, Kreuter, Chiossi (2026). "Sensing What Surveys Miss: Understanding and Personalizing Proactive LLM Support by User Modeling." CHI '26 (accepted per arXiv). [PR]** https://arxiv.org/abs/2602.00880
  - Finding: Within-subjects study (N=32). Physiologically aligned timing of LLM help raised accuracy by 21%, cut false negatives from 50.9% to 22.9%, and improved perceived dependability and benevolence compared with misaligned or random timing.
  - Implication: Timing alone (same content) changes outcomes and perceived trustworthiness.
- **Lepine, Kim, Mishkin, Beane (2025). "Precision Proactivity: Measuring Cognitive Load in Real-World AI-Assisted Work." arXiv 2505.10742 (major revision). [Preprint]** https://arxiv.org/abs/2505.10742
  - Finding: 34 financial professionals using GPT-4o, 1,178 subtask observations. Extraneous load had about 3× the negative association of intrinsic load. "Model-initiated task switching is the strongest predictor of decline."
  - Implication: Strong (preprint) evidence that AI-initiated topic switches are costly. An offer to switch topic is riskier than an offer that deepens the current one.
- **Lee, Xia, Numan, Qian, Li, Chen, Kulshrestha, Chatterjee (2025). "Sensible Agent: A Framework for Unobtrusive Interaction with Proactive AR Agents." UIST '25. [PR]** https://doi.org/10.1145/3746059.3747748
  - Finding: Proactive agents that rely on "explicit voice prompts or responses… can be disruptive". Adapting both *what* to offer and *how* to deliver it (minimally intrusive modes) cut perceived effort compared with a voice-prompted baseline (n=10).
  - Implication: In AR, voice is treated as the *intrusive* channel. In a car it is the only safe channel, so Souffleur has to make voice offers minimally intrusive (short, declinable, prosodically marked as optional).

**In-vehicle proactive voice and timing**
- **Semmens, Martelaro, Kaveti, Stent, Ju (2019). "Is Now A Good Time? An Empirical Study of Vehicle-Driver Communication Timing." CHI '19. [PR, Found.]** https://doi.org/10.1145/3290605.3300867
  - Finding: 63 drivers answered "Is now a good time?" during a 50-minute drive (2,734 responses). Easily accessible vehicle data helps predict good moments, but "certain nuances… require a richer understanding of the driver and environment states".
  - Implication: The key field precedent for timing in-car offers. Souffleur could log driving context alongside offers to analyse when offers were taken up.
- **Schmidt, Minker, Werner (2020). "How Users React to Proactive Voice Assistant Behavior While Driving." LREC 2020, pp. 485–490. [PR]** https://aclanthology.org/2020.lrec-1.61/
  - Finding: Wizard-of-Oz simulator study (N=42) with varied traffic density. Proactive behaviour was rated about as positively as non-proactive. 73.8% of proactive suggestions were accepted (82.5% for driving-relevant use cases). Users responded faster to proactive actions.
  - Implication: Baseline acceptance numbers for in-car offers. Souffleur's offers are not driving-relevant, so lower acceptance would be expected.
- **Mathis, Bubeck, Peissner (2024). "When to Approach the User: Investigating Suitable Context Factors for Proactive Voice Assistance in Automated Cars." Mensch und Computer '24. [PR]** https://doi.org/10.1145/3670653.3670672
  - Finding: Conjoint analysis. Some context factors make a situation suitable or unsuitable "independent of the suggested content". More relevant suggestions are acceptable in more situations.
  - Implication: Context gates offers first; relevance only widens the window.
- **Mathis, Günes, Entz, Lerch, Diederichs, Widlroither (2024). "Generating Proactive Suggestions based on the Context: User Evaluation of LLM Outputs for In-Vehicle Voice Assistants." CUI '24. [PR]** https://doi.org/10.1145/3640794.3665568
  - Finding: GPT-4 and Bison produced context-based proactive in-car suggestions that users rated positively in an online study.
  - Implication: LLM-generated in-car offers are feasible. Evaluation so far is online/vignette, not in the field, which is a gap Souffleur fills.
- **Du, Feng, Ma, Wang, Tao, Zhong, Li, Wang (2024). "Towards Proactive Interactions for In-Vehicle Conversational Assistants Utilizing Large Language Models." IJCAI '24. [PR]** https://doi.org/10.24963/ijcai.2024/869
  - Finding: Described in a secondary source as introducing "a hierarchy of proactive levels for in-vehicle conversational assistants with LLM operation strategies" — [arXiv 2606.22706](https://arxiv.org/pdf/2606.22706). Abstract not retrieved.
  - Implication: Gives a level taxonomy to position Souffleur against (Souffleur offers but does not act).
- **Susak, Liu, Jansen, Colley (2026). "ProVoice: Designing Proactive Functionality for In-Vehicle Conversational Assistants using Multi-Objective Bayesian Optimization to Enhance Driver Experience." CHI '26. [PR]** https://doi.org/10.1145/3772318.3791877 (arXiv: https://arxiv.org/abs/2601.19421)
  - Finding: Human-in-the-loop MOBO in a VR driving simulator (N=19) found intervention designs that "reduce[d] participant mental demand, alongside enhanced predictability and usefulness".
  - Implication: Predictability is now an explicit optimisation target for in-car proactive VAs. It maps onto G2 and G18.
- **Hamid, Li, Liang (2026). "When2Talk: When Should a Proactive In-Car Agent Talk?" arXiv 2609.12503 (submitted 11 Sep 2026). [Preprint]** https://arxiv.org/abs/2609.12503
  - Finding: VR autonomous-vehicle study (N=41). A context-sensitive policy (immediate / delayed / silent) beat event-triggered communication on appropriateness and "substantially reduced perceived interruption". "Perceived trust did not differ between policies." Four decision factors: event consequence, passenger activity, continuing information value, confirmation need.
  - Implication: The newest evidence that *silence* and *delay* are legitimate policy choices. The four factors could be adapted as Souffleur's offer-gating criteria. Note: a secondary search summary wrongly called this "CHI 2025"; arXiv shows it as a Sept 2026 preprint.
- **Janssen, Iqbal, Kun, Donker (2019). "Interrupted by my car? Implications of interruption and interleaving research for automated vehicles." IJHCS. [PR, Found.]** https://doi.org/10.1016/j.ijhcs.2019.07.004
  - Finding: Treats car-initiated interruptions as a multi-stage interruption-handling process (ten stages). It is unrealistic to expect immediate correct responses because drivers interleave attention.
  - Implication: An offer should not demand an immediate answer. "I'll hold that; say 'agenda' when ready" fits the interleaving model.
- **Wintersberger, Riener, Schartmüller, Frison, Weigl (2018). "Let Me Finish before I Take Over: Towards Attention Aware Device Integration in Highly Automated Vehicles." AutomotiveUI '18. [PR, Found.]** https://doi.org/10.1145/3239060.3239085
  - Finding: Simulator study (N=18). Requests issued at emerging task boundaries reduced stress, improved performance and raised acceptance/trust.
  - Implication: Converging evidence for task-boundary timing in the car.

### Inferences
- The literature gives a consistent recipe that matches the advisor's constraint: suggest, don't act (Kraus 2020; Peng 2019); ask, don't assume (Oh 2024); time offers to breakpoints (Iqbal & Bailey 2008; Wintersberger 2018; Semmens 2019); and treat silence or delay as a valid output (When2Talk 2026).
- "A declined offer must not come back" is almost unaddressed empirically. It follows from Horvitz's "minimise cost of poor guesses" and "learn by observing", Amershi G13, and Bansal et al.'s U3. Given ProactiveBench's ~66% F1, declines will be frequent, so decline-memory is a design contribution, not a detail.
- Topic-switching offers (e.g., "want an agenda for the drive?") may cost more than deepening offers (a recap when re-entering a topic), going by Lepine et al. (preprint). This is a testable distinction in Souffleur's data.
- Voice prompts are more compelling than screen prompts (Reicherts 2022). In AR, voice is classed as the intrusive channel (Sensible Agent 2025). So voice offers carry more steering power, which strengthens the case for strong declinability.

### Gaps
- No study found on *non-urgent, cognitive* proactive offers to drivers in naturalistic (on-road) conditions with an LLM agent. Existing in-car work is simulator, VR, conjoint or online.
- No study found that measures the effect of *repeating* a declined proactive suggestion in voice, or of a "don't ask again" memory.
- "Need Help?" (Chen et al., CHI 2025) design-element results beyond the abstract were not retrieved.
- Isbell & Pierce's "IP continuum" (interface-proactivity) could not be verified in Crossref and is omitted.

---

## Q3. Trust calibration, overreliance and processing fluency in voice

### Takeaway
The evidence points one way: speech raises perceived credibility and blunts people's sensitivity to missing sources and to inaccuracies.
- Spoken information is judged more credible than the same text.
- Missing source attribution and low accuracy hurt credibility *less* in audio.
- Conversational presentation (text or voice) makes inaccuracies harder to detect.
- Adding voice raises anthropomorphism and perceived accuracy.

First-person uncertainty expressions ("I'm not sure, but…") reduce overreliance, but LLMs rarely use them and people rely on outputs anyway. For a voice-only thinking partner whose organised output is reviewed later, overreliance at the desk (on the board) may matter more than overreliance in the car.

### Cited Findings
- **Gaiser & Utz (2023/2024). "Is Hearing Really Believing? The Importance of Modality for Perceived Message Credibility During Information Search With Smart Speakers." Journal of Media Psychology. [PR]** https://doi.org/10.1027/1864-1105/a000384
  - Finding: Two online experiments (n=399, n=398) varied modality × message accuracy × sponsor credibility. "Information presented by the voice of a smart speaker was generally perceived as more credible." "No source attribution and low message accuracy affected message credibility less in the auditive than in the textual modality, especially for participants with less topic involvement."
  - Implication: The strongest single citation for "voice output is perceived as more credible". G2/G11 omissions are less noticed in voice, so the system must volunteer them.
  - Related: Gaiser's dissertation (IWM Tübingen, defended March 2026) summarises that "identical information is rated as more credible when spoken rather than read – even when no source is cited" and that "interactive verification functions" help only if users engage with them — [IWM news, 2 Apr 2026](https://iwm-kmrc.de/en/news/2026-04-02) [thesis; not peer-reviewed as a unit].
- **Anderl, Klein, Sarigül, Schneider, Han, Fiedler, Utz (2024). "Conversational presentation mode increases credibility judgements during information search with ChatGPT." Scientific Reports 14. [PR]** https://doi.org/10.1038/s41598-024-67829-6
  - Finding: Two preregistered experiments. People "were better at detecting inaccuracies when identical information was provided as static text compared to both types of conversational agents" (text LLM and voice agent), whether branded or not.
  - Implication: Static text at the desk is the better place to check content. This is empirical support for the "desk form" as the place where verification (G2, G11, G9) happens.
- **Cohn, Pushkarna, Olanubi, Moran, Padgett, Mengesha, Heldreth (2024). "Believing Anthropomorphism: Examining the Role of Anthropomorphic Cues on Trust in Large Language Models." CHI EA '24. [PR, late-breaking]** https://doi.org/10.1145/3613905.3650818
  - Finding: N=2,165. "Speech + text" raised anthropomorphism and rated *information accuracy* compared with text only. First-person "I" raised accuracy ratings in one context.
  - Implication: Adding a voice inflates trust in content. Souffleur's spoken summaries need explicit calibration.
- **Kim, Liao, Vorvoreanu, Ballard, Vaughan (2024). "'I'm Not Sure, But…': Examining the Impact of Large Language Models' Uncertainty Expression on User Reliance and Trust." FAccT '24. [PR]** https://doi.org/10.1145/3630106.3658941
  - Finding: Preregistered, N=404, medical QA. First-person uncertainty expressions decreased confidence in the system and agreement with it, and *increased accuracy* by reducing (not eliminating) overreliance. General-perspective hedges ("It's not clear, but…") had weaker, non-significant effects.
  - Implication: Uncertainty can be expressed in one short spoken clause, which makes it a natural G2 "spoken form". The exact wording matters, so phrasing should be pre-tested.
- **Zhou, Hwang, Ren, Sap (2024). "Relying on the Unreliable: The Impact of Language Models' Reluctance to Express Uncertainty." ACL 2024. [PR]** https://doi.org/10.18653/v1/2024.acl-long.198 (arXiv: https://arxiv.org/abs/2401.06730)
  - Finding: Deployed LMs are "reluctant to express uncertainties… even when they produce incorrect responses". When prompted to give confidence they are overconfident (an average 47% error rate among confident responses). Users "rely heavily on LM generations, whether or not they are marked by certainty". Preference data are biased against uncertain text.
  - Implication: Uncertainty cues won't appear on their own. Souffleur would need to engineer them, and should not assume users discount hedged output.
- **Zhou, Jurafsky, Hashimoto (2023). "Navigating the Grey Area: How Expressions of Uncertainty and Overconfidence Affect Language Models." EMNLP 2023. [PR]** https://doi.org/10.18653/v1/2023.emnlp-main.335
  - Finding: About *model* behaviour. Epistemic markers in prompts change LM accuracy by more than 80%, and high-certainty markers cut accuracy by 7% compared with low-certainty ones.
  - Implication: Minor for user trust. It matters because a user's confident thinking-aloud ("I'm sure X…") may bias the LLM's organisation of their thoughts.
- **Liao & Vaughan (2024). "AI Transparency in the Age of LLMs: A Human-Centered Research Roadmap." Harvard Data Science Review. [PR]** https://doi.org/10.1162/99608f92.8036d03b
  - Finding: A research roadmap on transparency approaches for LLMs (model reporting, evaluation results, explanations, uncertainty communication) **(content summary from memory; not fetched this session)**.
  - Implication: A framing citation for why the "why" (G11) and "how well" (G2) problems are amplified by LLMs.
- **Dubiel, Halvey, Oplustil Gallegos, King (2020). "Persuasive Synthetic Speech: Voice Perception and User Behaviour." CUI '20. [PR, Found.]** https://doi.org/10.1145/3405755.3406120
  - Finding: A debating-style synthetic voice was rated "significantly more truthful and more involved" than an audiobook-style voice, but it did not change how often recommendations were followed.
  - Implication: Voice style shifts perceived truthfulness. The TTS voice should be chosen and reported as a study variable.
- **Schroeder & Epley (2015). "The Sound of Intellect: Speech Reveals a Thoughtful Mind." Psychological Science. [PR, Found.]** https://doi.org/10.1177/0956797615572906
  - Finding: Evaluators judged communicators as more competent, thoughtful and intelligent when they *heard* their pitch than when they read the same words **(abstract not retrieved; finding from memory, verify)**.
  - Implication: A psychological basis for voice → more credible.
- **Newman & Schwarz (2018). "Good Sound, Good Research: How Audio Quality Influences Perceptions of the Research and Researcher." Science Communication. [PR, Found.]** https://doi.org/10.1177/1075547018759345
  - Finding: Poorer audio quality lowered evaluations of the research and the researcher. This is a processing-fluency effect **(abstract not retrieved; verify)**.
  - Implication: In-car audio quality (road noise, TTS clarity) may itself shift perceived credibility. This is a confound to note.
- **Reber & Schwarz (1999). "Effects of Perceptual Fluency on Judgments of Truth." Consciousness and Cognition. [PR, Found.]** https://doi.org/10.1006/ccog.1999.0386
  - Finding: Statements that were easier to perceive were judged more likely true **(classic finding; abstract not retrieved)**.
  - Implication: The theoretical base for the "processing fluency" claim.
- **Fang et al. (2025). "How AI and Human Behaviors Shape Psychosocial Effects of Extended Chatbot Use: A Longitudinal Randomized Controlled Study." arXiv 2503.17473 (MIT Media Lab / OpenAI). [Preprint]** https://arxiv.org/abs/2503.17473
  - Finding: Four-week RCT (n=981, >300k messages) comparing text, neutral voice and engaging voice. "No significant effects were detected from experimental conditions". Heavier voluntary use and higher trust and social attraction were associated with worse outcomes (emotional dependence, problematic use).
  - Implication: Voice mode alone did not drive dependence in this study. User trust and usage intensity did, so trust calibration matters more than modality per se.
- **Bansal, Nushi, Kamar, Lasecki, Weld, Horvitz (2019). "Beyond Accuracy: The Role of Mental Models in Human-AI Team Performance." HCOMP '19. [PR, Found.]** https://doi.org/10.1609/hcomp.v7i1.5285
  - Finding: Team performance depends on the human's mental model of where the AI errs **(abstract not retrieved; from memory)**.
  - Implication: A rationale for G2: users need to learn *where* Souffleur's organisation goes wrong, which is easiest on the board.

### Inferences
- Voice is a credibility amplifier with weaker error detection (Gaiser & Utz; Anderl et al.; Cohn et al.). For Souffleur this cuts two ways:
  - In the car, spoken recaps and agendas will be over-trusted.
  - At the desk, the static board is where errors can be caught.

  This supports splitting calibration in two: a one-clause spoken hedge now (Kim et al. 2024), and inspection at the desk later (Anderl et al. 2024).
- Spoken source attribution ("from what you said on Tuesday…") is the voice form of G11. Gaiser & Utz show that missing attribution is penalised less in audio, so users won't demand it. The system has to volunteer it.
- Fluency effects (TTS quality, road noise) are confounds worth recording in the field study.

### Gaps
- No study found on trust calibration for an LLM that *organises the user's own thoughts* (as opposed to answering factual questions). Overreliance on one's own thinking as reorganised by AI is unstudied.
- No peer-reviewed study found on *how to* attribute sources in spoken LLM answers (format, length) and its effect on reliance. Search results were blogs or commercial pages, not research.
- Schroeder & Epley, Newman & Schwarz, Reber & Schwarz and Bansal (2019) findings are given from memory (abstracts not retrieved) and should be checked before quoting.

---

## Q4. Transparency, explanation, correction, status and global controls without a screen (including "explain later on a screen")

### Takeaway
Voice interaction research (conversation analysis) shows that silence and non-answers stall "progressivity". People cannot tell a working system from a broken one unless the system keeps the exchange visibly (audibly) moving. Recent LLM latency studies show:
- delays over about 4 s degrade experience;
- natural fillers improve perceived responsiveness;
- moderate latency can even raise perceived thoughtfulness, but long waits turn into reliability concerns.

Presence indicators reduce disruption in proactive agents. Older auditory-display work (earcons, audio progress bars) gives non-speech options. For explanations, in-vehicle studies find that explanations *before* an action build trust and those *after* do not, which is a caution for deferral. No study was found that evaluates time-shifted, cross-device explanation (voice now, screen later) as a design strategy. Global controls in voice assistants (privacy, mute) are rarely used because they don't fit the interaction.

### Cited Findings

**Status, silence and progressivity**
- **Porcheron, Fischer, Reeves, Sharples (2018). "Voice Interfaces in Everyday Life." CHI '18. [PR, Found.]** https://doi.org/10.1145/3173574.3174214
  - Finding: Month-long Echo deployments analysed with conversation analysis. VUI use is "finely coordinated with the sequential organisation of talk". The paper raises "the accountability of VUI interaction" and challenges calling these interfaces "conversational".
  - Implication: A voice system must make its state *accountable* (hearable) to the user. That is the frame for the field finding about silences.
- **Fischer, Reeves, Porcheron, Sikveland (2019). "Progressivity for Voice Interface Design." CUI '19. [PR, Found.]** https://doi.org/10.1145/3342775.3342788
  - Finding: Applies conversation analysis's preference for progressivity. "Non-answer responses impede progress". Accounts for non-answers can lead to recovery. Moving forward does not require a fitted answer.
  - Implication: Silence is the worst non-answer. Even a brief account ("still organising that…") restores progressivity.
- **Cho & Rader (2020). "The Role of Conversational Grounding in Supporting Symbiosis Between People and Digital Assistants." PACM HCI (CSCW). [PR]** https://doi.org/10.1145/3392838
  - Finding: "In 'smart speaker' digital assistant systems… there is no visual user interface, so people must learn about the system's capabilities and limitations by experimenting." The common "Sorry, I'm not sure how to help" "provided no feedback for participants to build on". Tangential answers grounded better.
  - Implication: G1/G2 in voice is learned through interaction. Uninformative failures stop users from exploring.
- **Luger & Sellen (2016). "'Like Having a Really Bad PA': The Gulf between User Expectation and Experience of Conversational Agents." CHI '16. [PR, Found.]** https://doi.org/10.1145/2858036.2858288
  - Finding: Users' expectations of CAs far exceeded what the systems did. The systems did little to convey capability or intelligence, and users had poor feedback about what the system could do **(abstract not retrieved; from memory, verify)**.
  - Implication: A G1/G2 failure in voice, observed before LLMs.
- **Skantze (2021). "Turn-taking in Conversational Systems and Human-Robot Interaction: A Review." Computer Speech & Language. [PR]** https://doi.org/10.1016/j.csl.2020.101178
  - Finding: Conversational systems "typically have problems with frequent interruptions and long response delays". The review covers cues for end-of-turn detection and turn-taking.
  - Implication: Think-aloud speech has long pauses, so end-of-turn detection and barge-in are central to whether an offer interrupts a thought.
- **Maslych, Katebi, Lee, Hmaiti, Ghasemaghaei, Pumarada, Palmer, Segarra Martinez, et al. (2025). "Mitigating Response Delays in Free-Form Conversations with LLM-powered Intelligent Virtual Agents." CUI '25. [PR]** https://doi.org/10.1145/3719160.3736636 (arXiv: https://arxiv.org/abs/2507.22352)
  - Finding: "Latency above 4 seconds degrades quality of experience, while natural conversational fillers improve perceived response time, especially in high-delay conditions" (VR, gestures plus verbal cues).
  - Implication: Gives a concrete threshold (about 4 s) for when Souffleur must say *something*. A secondary blog claimed that "spinners/processing tones" showed no benefit in this study; I could not confirm that from the abstract and leave it out.
- **Tan, Messerschmidt, Yin, Nov (2026). "The Impact of Response Latency and Task Type on Human-LLM Interaction and Perception." CHI '26 (per arXiv). [PR]** https://arxiv.org/abs/2604.06183
  - Finding: Time-to-first-token was 2, 9 or 20 s. Participants with 2 s latency rated outputs *less* thoughtful and useful than those with 9 or 20 s. Delays were attributed to "AI deliberation", but "long waits occasionally shifted this interpretation toward frustration or concerns about reliability."
  - Implication: Silence can read as thinking, up to a point. Without a cue, the user cannot tell "deliberating" from "broken", which is the Souffleur field finding. Latency is "a tunable design variable".
- **Shiwa, Kanda, Imai, Ishiguro, Hagita (2008). "How Quickly Should Communication Robots Respond?" HRI '08. [PR, Found.]** https://doi.org/10.1145/1349822.1349843 (journal version, Int J Soc Robotics 2009: https://doi.org/10.1007/s12369-009-0012-8)
  - Finding: Studied preferred robot response delay and showed that conversational fillers made longer delays more acceptable **(abstract not retrieved; from memory, verify the exact delay values before quoting)**.
  - Implication: A foundational citation for fillers.

**Non-speech audio for status**
- **Blattner, Sumikawa, Greenberg (1989). "Earcons and Icons: Their Structure and Common Design Principles." Human–Computer Interaction 4(1). [PR, Found.]** https://doi.org/10.1207/s15327051hci0401_1
  - Finding: Defines earcons, structured non-verbal audio messages **(from memory)**.
  - Implication: A vocabulary for "listening / thinking / saved" cues.
- **Brewster, Wright, Edwards (1993). "An Evaluation of Earcons for Use in Auditory Human-Computer Interfaces." INTERCHI '93. [PR, Found.]** https://doi.org/10.1145/169059.169179
  - Finding: Structured earcons can be learned and recognised. Musical timbres improve recognition **(from memory, verify)**.
  - Implication: Status earcons are viable if few and distinct.
- **Crease & Brewster (1998). "Making Progress With Sounds – The Design & Evaluation of an Audio Progress Bar." ICAD '98 (BCS eWiC). [PR, Found.]** https://doi.org/10.14236/ewic/ad1998.9
  - Finding: Designed and evaluated a non-speech audio progress indicator for background tasks **(abstract not retrieved; title-level claim)**.
  - Implication: Direct precedent for an audio "still working" cue that avoids speech while the user is thinking or driving.
- **Pu et al. (2025), CHI** (see Q2): "presence indicators… alleviated disruptions and improved users' awareness of AI processes" — https://doi.org/10.1145/3706598.3713357
  - Implication: Recent LLM-agent evidence that presence cues help. An audio presence cue (e.g., a soft periodic tone while organising) is the untested voice analogue.

**Explanation timing and explaining later**
- **Du, Haspiel, Zhang, Tilbury, Pradhan, Yang, Robert (2019). "Look Who's Talking Now: Implications of AV's Explanations on Driver's Trust, AV Preference, Anxiety and Mental Workload." Transportation Research Part C 104. [PR, Found.]** https://doi.org/10.1016/j.trc.2019.05.025
  - Finding: Simulator study (N=32) with no explanation, explanation before action, explanation after action, or approve/disapprove. "Explanations provided before an AV acted were associated with higher trust in and preference for the AV, but there was no difference in anxiety and workload." Explanations after the action did not have this benefit.
  - Implication: An important caution for "deferred guideline satisfaction". A G11 explanation delayed until after the fact may not build trust the way a prior one-clause reason does. Souffleur should give the short reason *with* the offer ("since you're back on X — want a recap?") and save detail for the desk.
- **Haspiel, Du, Meyerson, Robert, Tilbury, Yang, Pradhan (2018). "Explanations and Expectations: Trust Building in Automated Vehicles." HRI '18 Companion. [PR, LBR]** https://doi.org/10.1145/3173386.3177057
  - Finding: Preliminary pattern that explanations before AV actions promote more trust than explanations afterwards — [Semantic Scholar TLDR](https://doi.org/10.1145/3173386.3177057)
- **Koo, Kwac, Ju, Steinert, Leifer, Nass (2015). "Why did my car just do that? Explaining semi-autonomous driving actions to improve driver understanding, trust, and performance." IJIDeM 9. [PR, Found.]** https://doi.org/10.1007/s12008-014-0227-2
  - Finding: Compared "how", "why" and "how + why" spoken messages before automated braking. "Why" information was preferred emotionally. "How + why" gave the safest driving but more negative feelings **(abstract not retrieved; from memory, verify details)**.
  - Implication: A one-clause *why* is the best spoken form of G11 in a car. The fuller *how* belongs in the desk form.
- **Mathur & Desai (2026). "Explanations as Dialogues: Toward Human-Centered Conversational Explainable AI." CUI '26 (provocation). [PR]** https://doi.org/10.1145/3816046.3816314
  - Finding: Argues that explanations in conversational AI are "experienced as dialogue" and are "shaped by timing, tone, persona and conversational history".
  - Implication: Timing is part of what an explanation is, so the deferred desk form is a different explanation, not the same one delivered later.
- **Vtyurina, Fourney, Morris, Findlater, White (2019). "VERSE: Bridging Screen Readers and Voice Assistants for Enhanced Eyes-Free Web Search." ASSETS '19. [PR, Found.]** https://doi.org/10.1145/3308561.3353773
  - Finding: Survey (n=53 blind users). VAs "lack the ability to deeply engage with content" and to "get a quick overview of the landscape". VERSE added screen-reader-like navigation and let "other devices (e.g., smartwatches) serve as optional input accelerators".
  - Implication: Voice-only falls short for overview and depth, the very jobs Souffleur gives to the board. A precedent for multi-device division of labour.
- **Trippas, Spina, Cavedon, Joho, Sanderson (2018). "Informing the Design of Spoken Conversational Search." CHIIR '18. [PR, Found.]** https://doi.org/10.1145/3176349.3176387
  - Finding: Perspective paper on how audio-only results presentation must differ from screens **(abstract not retrieved)**.
  - Implication: Background for "one-clause spoken form".

**Correction and global controls**
- **Myers, Furqan, Nebolsky, Caro, Zhu (2018). "Patterns for How Users Overcome Obstacles in Voice User Interfaces." CHI '18. [PR, Found.]** https://doi.org/10.1145/3173574.3173580
  - Finding: NLP errors were the most frequent obstacle, but other obstacles (e.g., unclear feedback) were more likely to frustrate or confuse — [Semantic Scholar TLDR](https://doi.org/10.1145/3173574.3173580)
  - Implication: G9 (correction) in voice is often blocked by unclear feedback, not just recognition errors.
- **Lau, Zimmerman, Schaub (2018). "Alexa, Are You Listening? Privacy Perceptions, Concerns and Privacy-seeking Behaviors with Smart Speakers." PACM HCI (CSCW). [PR, Found.]** https://doi.org/10.1145/3274371
  - Finding: "Current smart speaker privacy controls are rarely used, as they are not well-aligned with users' needs". The authors recommend "better integrating privacy controls into smart speaker interaction".
  - Implication: Global controls (G17) in voice fail when they sit outside the conversational flow. Souffleur's controls ("fewer offers", "stop recording") should be speakable, and mirrored on the desk.
- **Bansal, Nushi, Kamar, Weld, Lasecki, Horvitz (2019). "Updates in Human-AI Teams: Understanding and Addressing the Performance/Compatibility Tradeoff." AAAI '19. [PR, Found.]** https://doi.org/10.1609/aaai.v33i01.33012429
  - Finding: "Updates that increase AI performance may actually hurt team performance" when they are incompatible with the user's prior experience.
  - Implication: The rationale for G14/G18 (update cautiously, notify about changes). Prompt or model changes during the field study should be announced, at least on the desk.
- **Amershi et al. (2019)**, voice examples (see Q1): G8 dismissal by "nevermind" or silence; G10 "trouble hearing me"; G9 achieved via an on-screen "Tap to Edit" — [PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)

### Inferences
- The field finding ("couldn't tell whether it was still working") is a progressivity and accountability failure (Porcheron 2018; Fischer 2019) and maps onto Bansal et al.'s A3 ("What is the agent currently doing?"). Fixes supported by the literature, in order:
  1. a short spoken account after about 4 s (Maslych 2025);
  2. a non-speech presence or progress cue (Crease & Brewster 1998; Pu 2025);
  3. never leaving silence ambiguous, since moderate latency can read as deliberation but long silence reads as failure (Tan 2026).
- Deferred guideline satisfaction is supported for G2, G9, G16, G17 and G18. Desk-side static text helps error detection (Anderl 2024), voice cannot give overview or depth (VERSE 2019), and Amershi's own voice example met G9 on screen.
- For G11 it is partly *contradicted* in-car: explanations after the fact did not build trust (Du 2019; Haspiel 2018). A defensible design is a one-clause "why" given at the time of the offer, with the "how" and the evidence deferred to the desk.
- G17 in voice needs speakable controls. Separate privacy and settings controls go unused (Lau 2018).

### Gaps
- No empirical study found that evaluates *time-shifted, cross-device* explanation or correction (voice now → screen later) for an AI agent. This is open for Souffleur to claim.
- No study found on earcons or progress sounds specifically for *LLM* voice agents' "thinking" state, or in vehicles for that purpose.
- I could not confirm the claim (from a vendor blog) that spinners or processing tones did not help in Maslych et al. (2025).

---

## Q5. Safety guidelines and evidence for in-vehicle speech interaction that constrain the design

### Takeaway
US federal guidance (NHTSA Phase 1 2013, Phase 2 proposed 2016) covers only *visual-manual* tasks: ≤2 s single glances and ≤12 s total eyes-off-road. NHTSA research describes auditory-vocal (Phase 3) guidance as forthcoming, and I found no evidence it was ever issued. ISO 15005:2017 gives dialogue-management principles for in-motion driver–system dialogues. Empirically, voice interaction is not free:
- In-vehicle voice systems impose moderate-to-high cognitive workload (mean 3.34/5).
- Residual distraction lasts up to 27 s after an interaction ends.
- Informal, personal LLM conversation styles are more distracting.
- On the other hand, conversation can counter passive fatigue, and passengers who share the driving context are less harmful than remote talkers.

For Souffleur, this means: no visual-manual demands while moving; offers that are short, declinable and spaced out (residual costs); deferral to the desk is safety-motivated, not just a design convenience.

### Cited Findings
- **NHTSA (2013). Visual-Manual NHTSA Driver Distraction Guidelines for In-Vehicle Electronic Devices (Phase 1), Federal Register, 26 Apr 2013 (exact FR page not verified). [Std, voluntary]** — restated in NHTSA's 2016 Phase 2 notice: tasks should be completable "with individual glances away from the roadway of 2 seconds or less and a cumulative time spent looking away from the roadway of 12 seconds or less" — [Federal Register, 5 Dec 2016 (Phase 2 proposed guidelines)](https://www.govinfo.gov/content/pkg/FR-2016-12-05/html/2016-29051.htm)
  - Phase 1 applies to original-equipment devices used "through visual-manual means" — [SWOV summary](https://swov.nl/en/publicatie/visual-manual-nhtsa-driver-distraction-guidelines-vehicle-electronic-devices)
  - Implication: Any board or screen glance in the car is governed by 2 s / 12 s. Souffleur's "no screen while driving" design follows from this.
- **NHTSA (2016) Phase 2 notice** also states that in naturalistic data "non-visual-manual operations, such as conversing on a cell phone, were not found to be associated with an increase in crash risk", while "research conducted in simulators and on test tracks has found driving performance decrements when driving while talking on a cell phone" — [Federal Register 2016](https://www.govinfo.gov/content/pkg/FR-2016-12-05/html/2016-29051.htm)
  - Implication: Evidence on the safety of voice is contested. The paper should not claim voice is "safe", only that it avoids visual-manual demand.
- **NHTSA, "Vehicle Voice Control Interface Performance Evaluation" (final report). [Std research]** — search snippets of the NHTSA page state that "Phase 3 guidelines (forthcoming) will address voice-based auditory interfaces" and that the research "will inform development of Phase 3" — [NHTSA page](https://nhtsa.gov/document/vehicle-voice-control-interface-performance-evaluation-final-report) (page returned 403; claim taken from search snippet, verify) and [TRID record](https://trid.trb.org/view.aspx?id=1429535)
  - Implication: There is no US auditory-vocal guideline to comply with. This is a regulatory gap worth stating.
- **ISO 15005:2017. Road vehicles — Ergonomic aspects of transport information and control systems — Dialogue management principles and compliance procedures. [Std]** — "specifies ergonomic principles for the design of the dialogues that take place between the driver of a road vehicle and the vehicle's transport information and control systems (TICS) while the vehicle is in motion" — [standard listing (GlobalSpec)](https://standards.globalspec.com/std/10148608/iso-15005); [ANSI webstore](https://webstore.ansi.org/standards/bsi/bseniso150052017)
  - ISO 15006:2011 (auditory presentation of in-vehicle information) is cross-referenced (specific content not verified).
  - Implication: A recognised standard for driver–system dialogue. It applies to built-in TICS, so a phone-based research prototype is at most "informed by" it. It is worth citing as the design constraint.
- **Strayer, Cooper, Turrill, Coleman, Hopman (2015). "Measuring Cognitive Distraction in the Automobile III: A Comparison of Ten 2015 In-Vehicle Information Systems." AAA Foundation for Traffic Safety. [Technical report]** https://aaafoundation.org/wp-content/uploads/2026/01/MeasuringCognitiveDistractionintheAutomobileIIIReport.pdf
  - Finding: N=257. Cognitive workload of voice-based IVIS was "moderate to high, averaging 3.34 on a 5-point scale and ranged from 2.37 to 4.57". "Practice did not eliminate the interference". "Significant residual costs were observed for 27 seconds after the IVIS interaction had terminated". The authors caution that "these voice-based interactions can be cognitively demanding and ought not to be used indiscriminately while operating a motor vehicle."
  - Implication: The 27 s residual cost argues for spacing offers out and keeping them short. Several back-to-back offers stack their costs.
- **Strayer, Cooper, Goethe, McCarty, Getty, Biondi (2019). "Assessing the visual and cognitive demands of in-vehicle information systems." Cognitive Research: Principles and Implications. [PR]** https://doi.org/10.1186/s41235-019-0166-3
  - Finding: Workload varied with task, mode (including auditory-vocal) and vehicle. "Many of these IVIS features are too distracting to be enabled while the vehicle is in motion". Designers should ask "what interactions should be available to the driver when the vehicle is in motion".
  - Implication: Motivates gating features by vehicle state, e.g., macros proposed only when stopped or deferred to the desk.
- **Caird, Simmons, Wiley, Johnston, Horrey (2018). "Does Talking on a Cell Phone, With a Passenger, or Dialing Affect Driving Performance? An Updated Systematic Review and Meta-Analysis." Human Factors. [PR]** https://doi.org/10.1177/0018720817748145
  - Finding: Phone *and* passenger conversation produced moderate performance costs. Drivers compensated minimally — [Semantic Scholar TLDR](https://doi.org/10.1177/0018720817748145)
  - Implication: Talking to Souffleur is a conversation, and conversation has costs.
- **Drews, Pasupathi, Strayer (2008). "Passenger and Cell Phone Conversations in Simulated Driving." J. Experimental Psychology: Applied 14(4). [PR, Found.]** https://doi.org/10.1037/a0013119
  - Finding: Passenger conversations impaired driving less than phone conversations. Passengers shared situation awareness and adjusted the conversation to traffic **(abstract not retrieved; from memory, verify)**.
  - Implication: A "co-present passenger" model, where the agent goes quiet when traffic demands rise, is the safety ideal Souffleur could approach with context sensing (cf. When2Talk's "silent" policy).
- **Kun, Shyrokov, Heeman (2012/2013). "Interactions between human–human multi-threaded dialogues and driving." Personal and Ubiquitous Computing. [PR, Found.]** https://doi.org/10.1007/s00779-012-0518-1
  - Finding: Interface design can draw on how people manage interrupted, multi-threaded dialogues while driving — [Semantic Scholar TLDR](https://doi.org/10.1007/s00779-012-0518-1)
  - Implication: Supports suspend-and-resume of thought threads, i.e., the "recap when re-entering a topic".
- **Dittrich, Ko, Rieger (2025). "Impact of Voice Assistants' Conversational Style on Cognitive Driver Distraction." IVA '25. [PR]** https://doi.org/10.1145/3717511.3749294
  - Finding: Simulator (N=30). An informal LLM-assistant style "tends to be more distracting, especially when discussing personal topics".
  - Implication: A thinking partner talks about personal and work topics by nature. A concise, neutral style for offers is safer.
- **Large, Burnett, Antrobus, Skrypchuk (2018). "Driven to discussion: engaging drivers in conversation with a digital assistant as a countermeasure to passive task-related fatigue." IET Intelligent Transport Systems. [PR, Found.]** https://doi.org/10.1049/iet-its.2017.0201
  - Finding: Wizard-of-Oz assistant "Vid" (N=20, 30-minute drives). Conversation improved lane-keeping and hazard response, raised arousal and reduced cognitive tunnelling.
  - Implication: On monotonous commutes, engaging conversation may *help*. Safety depends on context, not simply on "less talk".
- **Large, Burnett, Clark (2019). "Lessons from Oz: Design Guidelines for Automotive Conversational User Interfaces." AutomotiveUI '19 Adjunct. [PR, short]** https://doi.org/10.1145/3349263.3351314
  - Finding: Nascent guidelines from Wizard-of-Oz in-car CUI studies, aiming for interactions that are "safe, effective, engaging and enjoyable"; observed benefits for workload, fatigue, trust and acceptance.
  - Implication: The main AutoUI guideline source for in-car CUIs. It does not address LLMs or proactive offers.
- **Janssen et al. (2019); Wintersberger et al. (2018); Semmens et al. (2019)** — see Q2: timing at task boundaries, multi-stage interruption handling, nuanced "good time" prediction.

### Inferences
- The regulatory picture: visual-manual is regulated (voluntarily), and auditory-vocal is not. Souffleur's design choice (voice in car, screen at desk) is safety-aligned, but the paper must not imply that voice is distraction-free. The AAA residual-cost and workload data are the honest counterweight.
- Concrete constraints to state in the paper:
  1. no visual-manual interaction while moving (NHTSA);
  2. short, declinable offers with spacing longer than residual-cost windows (AAA 2015);
  3. a neutral, concise offer style (Dittrich 2025);
  4. context-gated silence (Drews 2008; When2Talk 2026).

### Gaps
- No evidence found that NHTSA ever issued Phase 3 (auditory-vocal) guidelines. The NHTSA page could not be opened (403), so the "forthcoming" wording comes from a search snippet.
- ISO 15005/15006 full texts are paywalled. Only the scope statements were verified.
- I did not find AutoUI 2023–2026 studies that measure workload for *open-ended LLM thinking-aloud* while driving. Existing studies cover commands, suggestions, or WoZ chat.
- European guidance (European Statement of Principles on HMI, 2008/653/EC) and UNECE rules were not checked this session.

---

## Q6. What gaps remain that this study could claim?

### Takeaway
The intersection of (a) voice-only output, (b) eyes-busy, attention-elsewhere context, (c) a proactive LLM agent, and (d) a thinking-partner role whose results are reviewed later on a screen is not covered by any guideline set or empirical study I found. Specific open gaps include:
- the voice/vehicle gaps that Amershi et al. themselves flagged;
- proactive-specific evaluation methods (BEHAVE AI, 2025);
- deferred cross-device satisfaction of guidelines;
- decline-memory for offers;
- audible "still working" status for LLM agents;
- calibration of trust in an AI's reorganisation of the user's own thoughts.

### Cited Findings
- Amershi et al. state that guidelines "do not directly apply to AI systems that lack graphical user interfaces (e.g., voice-based virtual assistants…)" and that "specialized guidelines may be required in… semi-autonomous vehicles" — [Amershi et al. 2019 PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
- BEHAVE AI: existing human-AI guidelines "only lightly touch on proactive behavior"; standard UX questionnaires are validated only for reactive systems; and there is "a deficiency of standardization in terms of design and evaluation methods" for proactive agents — [Kraus et al. 2025](https://doi.org/10.1145/3708557.3716155)
- Bérubé et al.: proactive VA benefits are clear mainly for safety-critical or emergency situations, with "significant knowledge gaps… regarding optimal conditions for implementing proactive features" — [CHB Reports 2024](https://doi.org/10.1016/j.chbr.2024.100411)
- Kraus et al. (2026): "proactivity" remains "conceptually underspecified and inconsistently applied" — [CUI '26](https://doi.org/10.1145/3816046.3816303)
- Bansal et al. (2024) call for "new design patterns, principles, and guidelines to support transparency and control" in agents, without addressing voice — [arXiv 2412.10380](https://arxiv.org/abs/2412.10380)
- Weisz et al. (2024) generative-AI principles do not address voice or unprompted behaviour — [arXiv HTML](https://arxiv.org/html/2401.14484)
- Du et al. (2019) show that in-car explanation *timing* changes trust, which is not addressed by Amershi's G11 — [TR-C](https://doi.org/10.1016/j.trc.2019.05.025)
- Gaiser & Utz (2024) and Anderl et al. (2024): voice and conversational presentation weaken credibility discrimination; static text is better for detecting errors — [JMP](https://doi.org/10.1027/1864-1105/a000384); [Sci Rep](https://doi.org/10.1038/s41598-024-67829-6)

### Inferences (candidate claims for the paper)
1. **First field account of what Amershi's guidelines mean with no screen and with attention elsewhere.** Amershi et al. predicted poor fit for voice and vehicles but never tested it. Souffleur's audit plus field data supplies the evidence.
2. **"Deferred guideline satisfaction" as a named design strategy.** Support:
   - Amershi's voice G9 example (correction via screen);
   - VERSE (multi-device division of labour);
   - Anderl et al. (static text is better for verification);
   - NHTSA (no visual-manual while moving).

   Boundary condition: the in-car explanation-timing evidence (Du 2019) suggests G11 cannot be fully deferred. A one-clause "why" must come with the offer.
3. **Offer-not-assign proactivity with decline-memory.** Builds on Oh et al. 2024, Kraus 2020 and Peng 2019 for the "offer" part, and Horvitz 1999, Bansal's U3 and ProactiveBench's ~66% F1 for why declines will be common. No empirical work on not re-offering was found.
4. **Status during silence as a voice-specific transparency problem.** This is Bansal's A3 ("What is the agent currently doing?") recast for voice:
   - Porcheron 2018 and Fischer 2019: silence breaks progressivity.
   - Maslych 2025: about 4 s threshold.
   - Tan 2026: silence read as deliberation until it reads as failure.
   - Pu 2025: presence indicators help.

   The early field data ("couldn't tell whether it was still working") is direct evidence.
5. **Trust calibration for AI-reorganised self-generated thought.** Existing overreliance work (Kim 2024; Zhou 2024) concerns factual answers. Souffleur concerns the AI's restructuring of the user's own ideas, which is a different object of reliance.
6. **IMWUT fit:** in-the-wild proactivity studies already appear in IMWUT (Meurisch et al. 2020; Tabassum et al. 2019), so a commuting field study of a proactive voice LLM extends an IMWUT line of work.

### Gaps
- I may have missed industry white papers (Amazon Alexa proactive-notification guidelines, Apple HIG for generative AI, Google conversation-design guidance) that discuss voice proactivity. These were not checked and should be read before claiming "no guideline exists".
- I did not verify any 2025–2026 IMWUT papers on proactive voice agents specifically. A targeted IMWUT search is advised before submission.
- Several foundational findings are given from memory and flagged above (Horvitz 1999 principle wording; McFarlane 2002; Schroeder & Epley 2015; Newman & Schwarz 2018; Reber & Schwarz 1999; Koo et al. 2015; Drews et al. 2008; Shiwa et al. 2008; Luger & Sellen 2016; earcon papers). Check them before quoting.
