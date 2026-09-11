# Figure generation workflow

Generate textbook-style educational images for the subject  *social-case-work*.

Source subject folder:

`source/course/bsw/second-year/social-case-work

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

5. Preserve the figure’s requested layout, curves, labels, arrows , and relationships. Use exact quoted text for important labels, formulas, and titles. White background color only.
6. Generate exactly one image per figure—no variants, previews, retries, or alternate versions.

7. Use this consistent visual style unless the figure specifies otherwise:
   - handwritten educational textbook diagram
   - warm cream/white paper background
   - clean dark axes and labels
   - hand-lettered but fully legible English text
   - subtle pencil/sketch texture
   - spacious, uncluttered composition

8. Generate and save all requested images for the subject. Do not run TinyPNG after each image and do not wait for source minification.

9. After all images are saved, report the subject folder and give the user one recursive batch command using only that subject folder:

   `npm run tinify -- "source/course/[course]/[year-or-semester]/[subject]"`

   Replace the bracketed parts with the actual subject folder path. Do not list individual chapter folders or image files. The command automatically scans every chapter and nested folder inside the subject, minifying all supported images while preserving filenames and extensions. The user will run it locally; do not run it unless explicitly requested. Do not run `npm run build` or `npm run sync` unless explicitly requested.


# Generate images only for the following units and figures:


Unit I: Tools and Skills for Problem Diagnosis
fig 1.1 — Observation and Participant Observation — Two-side mapping showing ordinary observation and participant observation, with the worker's level of involvement emphasized. Style: hand-drawn comparison layout, two columns or bubble pairs linked by lines, labels in handwritten font, pencil-sketch feel.
fig 1.2 — Problem Diagnosis Tools — Central Problem Diagnosis node branching to Listening, Communication, Observation, Interview, Home Visit, Survey and Recording. Style: hand-drawn mind map, central bubble with radiating branches, key terms in handwritten font, color per branch.


Unit II: Counselling and Casework..
