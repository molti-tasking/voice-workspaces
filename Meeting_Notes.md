Sep 9, 2026

## **Voice AI Agents — advisor discussion, recorded with the tool**

### **Summary**

A seven-minute discussion between Anton and the advisor, recorded through the tool itself with talk-back on. It produced a concrete requirement (an agenda for the drive), a design tension worth writing up (being prompted by a machine is insulting, and still useful), a research framing for the evaluation (context switching across many parallel projects), and updated paper targets. The system's own turns during the recording were all defective; they are recorded as findings at the end.

**Agenda for the drive**  
The advisor wants the system to propose what to talk about, fitted to the time available, to open warm rather than cold, and to give a short recap on re-entry into a topic.

**Evaluation focus**  
Anton proposed pinning the evaluation on multi-project context switching during drives, to distinguish the work from prior voice assistants. The advisor agreed.

**Paper targets**  
Both deadlines are in November: malleable forms to EICS, the voice work to IMWUT.

### **Decisions**

## Aligned

- **Evaluation focus: supporting context switching across many projects** The evaluation built into the system will centre on a person with many parallel projects who uses drives to switch between them, drawing on interruption and context-switching research and on process practices from software engineering. Agreed in conversation; subject to how it is written up.

- **Paper targets updated** Malleable forms goes to EICS; the voice work goes to IMWUT ("more of the human side", mobile, in the field). Both deadlines are in November. This supersedes the September CHI target in the Aug 4 notes.

## Tentative

- **An agenda capability that offers, never assigns** An opening turn ("last time you were on X; the intro of Y hasn't come up"), a transition when a topic lands sized to the remaining time, and a recap on re-entry. The advisor's condition: the person prompts the system, not the other way round, so the system offers and a declined offer is not repeated. Not designed yet; the requirement is recorded in TALKBACK.md under "Still open".

- **Motion-based setting detection: keep or drop** Demoed; the reaction was "maybe too much". Open whether it stays in the study.

### **Details**

- **The need, in the advisor's words**: "some system that helps me schedule what to talk about." "Sometimes I know it's 15 minutes but I want to talk about something five minutes ... it would be useful if it could tell me okay you're done with this, here's another topic that is another five minutes." "Even if I just manage, it gets added to this pile of this growing context." "Normally it's cold, but having a prompt I think would be useful." "I am writing 15 papers ... one paper you haven't talked about the intro. Talk about it now." "Normally I might spend a few minutes just getting back to what I was talking about, but if it could say 'this paper is on voice notations and so on', that would be a useful prompt."

- **The tension**: "Scheduling the human is a bit insulting in a way, and also prompting the human is a little insulting. I am the one who prompts. You don't prompt me. You don't tell me what to do. I tell you what to do. But sometimes it is useful knowing when to talk about something." Anton's phrase for the concept: a voice AI "doing the load balancing for the user". The advisor's analogy: a scrum master for one person's too-many-projects, with the open question whether AI makes that role more important or redundant.

- **Research framing**: The advisor pointed to the literature on context switching, which is expensive "in whatever dimension we want to think about it" and which processes are designed to reduce, and suggested the system could support a human in the same way. Anton proposed using this as the focus of the evaluation to get "a clear distinction from all the other stuff that has been done". Pointers to check: González & Mark (2004) on multitasking, Mark, Gudith & Klocke (2008) on the cost of interrupted work, and developer task-switching studies.

- **What the system knows already**: the memory index holds where each topic stands (claims, open questions, next steps) and recall puts it in front of the model on every turn. What is missing is a turn nobody asked for: `agent_turn.kind = 'proactive_prompt'` exists in the schema and nothing writes it. Two inputs do not exist yet: an estimate of how long the drive will be, and what a paper should cover, so that "you haven't talked about the intro" is computable.

- **Demo state**: William's prompts had never worked ("I never really tested it"); Anton made them more proactive but they are still "very defensive". Three selectable voices are in; the advisor liked the American-South one. Motion-based setting detection (accelerometer → driving / walking / desk) was shown.

- **What the system did during the recording** (five agent turns in seven minutes, none useful): three one-word fragments ("The", "So", "There"), which were replies cut off by the next speaker and recorded without the interrupted flag because the container never sent it; one turn that said "sil", an interrupted `<silence>` released to speech; and one turn that narrated its own rule aloud, speaker tag included ("[Speaker 2]'s question — whether it'll talk back — is for them to test live, not for me to answer"). The durations shown beside turns ("spoke 0.2s") were an estimate from character count, not measured. Fixes and regression cases went into the repo the same day.

---

Aug 4, 2026

## **Voice AI Agents**

### **Summary**

Project scope refined through research separation and taxonomy development regarding voice-first interfaces and generative interaction models.

**Voice Research Strategy**  
Sketch notes concepts were abandoned in favor of voice-first epistemic gap detection. New designs explore artificial intelligence thinking partners for visual reasoning and search assistance.

**Strategic Project Separation**  
Research contributions regarding malleable forms and voice-first interaction were separated to ensure focused conference submissions. This strategy supports developing independent generative interfaces that evolve through user-defined meta-commands.

**Voice Interaction Taxonomy**  
Interaction design now classifies speech into distinct categories including content and meta-editorial commands. System functionalities are organized into actions, modes, and personas to guide automated workflows.

### **Decisions**

## Aligned

- **Sketch notes project discontinued** The team decided to discontinue the sketch notes project, as they concluded it is not a strong use case.

- **Malleable Forms project maintained separately** The Malleable Forms project will be maintained as a separate project distinct from the new voice-based research.

- **Voice Studio concept adopted** The team adopted the Voice Studio concept, defined by three categories of skills: operational actions, conversation modes, and interaction personas.

### **Details**

- **Sketch Notes vs. Voice-First Exploration**: William reported that the initial "sketch notes" concept was not a viable use case. Instead, the discussion pivoted toward leveraging voice-first interaction for "epistemic gap detection," with William referencing Stanford’s "Costorm" paper regarding the use of LLM agents for identifying gaps in reasoning. The team considered developing a "voice mural" where an AI thinking partner could perform searches, analyze ideas, and populate visual representations based on voice input.

- **Strategic Project Separation**: Niklas advised keeping the "Malleable Forms" work as a separate project rather than merging it with the new voice-first research. Niklas argued that maintaining "watertight seals" between research projects ensures each submission remains focused and prevents reviewers from becoming confused by mixed contributions, noting that the "Malleable Forms" project should be revised for submission to a conference like CHI.

- **Concept of Generative Interfaces for Voice**: Niklas introduced the concept of "Generative Interfaces," where software builds itself dynamically based on user needs, specifically for scenarios like driving where visual interfaces are impractical. The proposed "voice studio" would allow users to develop custom "meta-comments" or editorial directions—such as requesting specific types of summaries—that enable the interface to evolve and become more personalized over time.

- **Meta-Commands and Workflow Automation**: The participants discussed the distinction between content and "meta-commands," which function as instructions for the AI on how to process information. William compared this to "Cloud Code" skills, suggesting that specific voice commands could trigger complex, automated workflows—such as summarizing topics or formatting output—allowing the system to handle repetitive tasks without the user needing to manually copy and paste prompts.

- **Framework for Reifiable Actions**: Building on the concept of "reification" from the "Direct GPT" paper, the team discussed allowing users to create, store, and trigger custom operations. These reusable "skills" or "actions" would exist within the voice studio, enabling users to build a library of personalized tools that could eventually be shared or published.

- **Taxonomy of Voice Interaction**: The group analyzed the need to classify speech into distinct categories: "content" (the primary information) and "meta-editorial comments" (directions for the system). Niklas used the "Midas Touch" analogy to describe the challenge of preventing the AI from misinterpreting administrative or editorial commands as part of the substantive content.

- **Modes, Personas, and Skills**: The team categorized potential system functionalities into three distinct skill classes: "Actions" (operations on content), "Modes" (the type of conversation, such as interviews or note-taking), and "Personas" (the nature of the AI’s feedback, such as critical or supportive). This structure would allow a user to invoke specific modes or personalities to guide the AI’s interaction style during different tasks.

- **Implementation Coordination**: To prepare for the upcoming September deadline for CHI, Niklas, William, and Anton agreed to divide tasks effectively. Anton and Niklas will meet to discuss evaluation strategies, and William and Anton will coordinate their development efforts to avoid duplicating implementation work.
