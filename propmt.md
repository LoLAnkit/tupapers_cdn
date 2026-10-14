**# Figure generation workflow**

Generate textbook-style educational images generation for below source folder.

Source subject folder:

`source/course/bca/second-semester/discrete-structure`

I will paste one or more units below. For each unit:

1. Create a separate chapter folder inside the subject folder, using this naming format:

`u[UNIT-NUMBER]-[chapter-title-in-kebab-case]`

Example: `u1-introduction`

2. Generate one separate image for every listed figure. Do not combine multiple figures into one image.

3. Save each final image in its matching chapter folder with a meaningful kebab-case filename based on its content.

Example:

`micro-vs-macro-economics-scope.png`

`macroeconomic-goals-and-instruments.png`

4. Use the built-in image generator. Do not use placeholder images.

5. Preserve the figure’s requested layout, curves, labels, arrows, and relationships. Use exact quoted text for important labels, formulas, and titles. White background color only.

6. Generate exactly one image per figure—no variants, previews, retries, or alternate versions.

7. Use this consistent visual style unless the figure specifies otherwise:

* handwritten educational textbook diagram

* warm cream/white paper background

* clean dark axes and labels

* hand-lettered but fully legible English text

* subtle pencil/sketch texture

* spacious, uncluttered composition

8. Generate and save all requested images for the subject accurately Do not mismatch the name of images.

**# Generate images only for the following units and figures.**
Unit 1: Set Theory
Figure Recommendations
Set Notation Comparison — Side-by-side hand-drawn illustration contrasting roster notation (listing elements) vs. set-builder notation (rule-based), with annotated curly braces, element symbols, and a vertical bar separator, clarifying when each form is used. Style: /handwrittenimages illustration, white background
Set Relationships Hierarchy — Labeled diagram showing the containment relationship among Universal set, proper subsets, subsets, and the empty set, drawn as nested regions with annotations showing the distinctions. Style: /handwrittenimages diagram, white background
Venn Diagram Operations — Four-panel hand-drawn Venn diagram showing Union (A∪B), Intersection (A∩B), Difference (A−B), and Complement (A′), each with shaded regions and set notation labels. Style: /handwrittenimages illustration, white background
Symmetric Difference Illustrated — Venn diagram of two sets with both exclusive regions highlighted and the symmetric difference formula (A△B = (A−B)∪(B−A)) annotated, clearly distinguishing it from union and intersection. Style: /handwrittenimages diagram, white background
Set Identities Proof Methods — Comparison diagram of two proof approaches side-by-side: algebraic law manipulation (chain of set identity steps) vs. Venn diagram shading method, for the same identity. Style: /handwrittenimages comparison illustration, white background
Cartesian Product as Ordered Pairs — Grid-style illustration of A×B where A={a,b} and B={1,2,3}, showing arrows from each A-element to each B-element forming ordered pairs, with the resulting set listed. Style: /handwrittenimages diagram, white background
Power Set Structure — Tree diagram showing a set {a,b,c} expanding into its 8 subsets (power set), illustrating cardinality 2^n and the subset-of relationship between levels. Style: /handwrittenimages diagram, white background
Unit 2: Logic and Propositional Calculus
Figure Recommendations
Logical Connectives Summary — Illustrated reference chart mapping each connective (AND, OR, NOT, IMPLICATION, BICONDITIONAL) to its symbol, natural-language reading, and a miniature 2-row truth table, arranged as a hand-drawn reference card. Style: /handwrittenimages illustration, white background
Truth Table Construction Process — Step-by-step flowchart of how to build a truth table for a compound proposition: enumerate rows → evaluate sub-expressions → evaluate full expression, with a worked example column. Style: /handwrittenimages flowchart, white background
Tautology vs. Contradiction vs. Contingency — Three-panel diagram showing a truth table column that is all-T (tautology), all-F (contradiction), and mixed (contingency), with labeled examples of each formula type. Style: /handwrittenimages comparison illustration, white background
De Morgan's Laws Visualized — Dual Venn diagram side-by-side: ¬(A∨B) = ¬A∧¬B and ¬(A∧B) = ¬A∨¬B, with shading that traces how negation distributes, plus the algebraic equivalence written below each panel. Style: /handwrittenimages diagram, white background
Rules of Inference Flowchart — Hand-drawn flowchart summarizing Modus Ponens, Modus Tollens, Hypothetical Syllogism, and Disjunctive Syllogism as numbered inference patterns with premise/conclusion format and brief annotations on when each applies. Style: /handwrittenimages flowchart, white background
Proof Methods Comparison — Four-quadrant diagram contrasting Direct, Indirect, Contradiction, and Contrapositive proof methods, showing the starting assumption, reasoning direction, and what is ultimately proved for each method. Style: /handwrittenimages comparison illustration, white background