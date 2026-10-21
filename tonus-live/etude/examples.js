/* ============================================================
   étude — example pieces for the REPL
   ============================================================ */

export const EXAMPLES = [
  {
    name: "pizzicato beat",
    note: "boom-bap drums, a plucked bass and off-beat violin chords",
    code: `// a beat, written like a score
tempo 92

drums kit: | kick (r kick) snare (r kick) | kick (kick r) snare (r snare) |
drums hats: | hat*8 |
  dynamics pp mf p mf
drums open: | r r r (r openhat) |
  dynamics p

bass: | D2 (r D2) (r A1) (C2 D2) | % |
  bowing pizz
  tone tasto

violin: | r (D5+A5 r) r (C5+G5 r) | r (D5+A5 r) r (F5+C6 r) |
  bowing pizz
  echo 0.4 dotted-eighth
  hall chapel
  seat left

cello: | D3 - - - | F3 - E3 - |
  bowing legato
  dynamics p < mf > p
  hall concert
  seat right`,
  },
  {
    name: "theme and variations",
    note: "variables, a loop with a counter, and a different ending the last time",
    code: `// theme and variations — let, repeat, if
tempo 104
key D minor

let theme = | D5 (E5 F5) G5 A5 | B5 A5 G5 - |
let cadence = | (C#5 D5) E5 D5 - |
let soft = p
let loud = f

violin:
  repeat 4 as n: | theme up n - 1 | if n is last then | cadence | else | A5 - - r |
  dynamics soft < loud over 12
  hall concert

let groove = | kick (r kick) snare (r kick) |
drums:
  repeat 3 as n: | groove | if n is even then | kick kick snare (snare snare) | else | groove |
drums hats: | hat*8 |
  dynamics pp mf

cello:
  repeat 4 as n: | D3 - - - | G2 - - - | if n is last then | A2 - - - | else | Bb2 - - - |
  bowing legato
  hall concert`,
  },
  {
    name: "four on the floor",
    note: "a dance groove with a hairpin on the hats",
    code: `tempo 124

drums kick: | kick*4 |
drums clap: | r clap r clap |
drums hats: | (r hat)*4 |
  tone 2000 < 9000 over 4

bass: | (A1 A2)*4 | (F1 F2)*4 | (C2 C3)*4 | (G1 G2)*4 |
  bowing spiccato
  tone tasto < ponticello > tasto over 8

organ: | A3+C4+E4 - - - | F3+A3+C4 - - - | C4+E4+G4 - - - | G3+B3+D4 - - - |
  dynamics mp
  hall studio`,
  },
  {
    name: "waltz",
    note: "3/4 with a repeat and simile",
    code: `tempo 138
time 3/4
key G major

violin: |: D5 (G5 A5) B5 | A5 - G5 | (F5 E5) (D5 C5) (B4 A4) | G4 - r :|
  bowing detache
  hall concert

cello: |: G2 D3 D3 | % | C3 E3 E3 | D3 F3 F3 :|
  bowing staccato
  seat right

harp: | r B3+D4 B3+D4 | r B3+D4 B3+D4 | r A3+C4 A3+C4 | r A3+C4 A3+C4 |
  dynamics p`,
  },
  {
    name: "dub",
    note: "echoing pizzicato and a cathedral melody",
    code: `tempo 110
key D minor

violin pizz: | r (D4+A4+F5 r) r (D4+A4+F5 r) | % | r (D4+B4+G5 r) r (D4+B4+G5 r) | % |
  bowing pizz
  echo 0.5
drums: | kick rim |
  echo 0.5
violin: | D5 - - A4 | B4 - A4 G4 | F4 - E4 F4 | D4 - - r |
  bowing legato
  hall cathedral
  dynamics mp
bass: | D2 (r D2) A2 (G2 F2) | (D2 r) (D2 r) D2 r | % | (D2 r) (D2 r) F2 r |
  tone tasto`,
  },
  {
    name: "string quartet",
    note: "four voices seated across the stage",
    code: `tempo Andante
key G major

violin I: | B5 - A5 G5 | F5 - E5 D5 | C5 - B4 A4 | G4 - - r |
  bowing legato
  seat left
  hall concert
violin II: | D5 - C5 B4 | A4 - G4 F4 | E4 - D4 C4 | B3 - - r |
  bowing legato
  seat center-left
  hall concert
  dynamics mp
viola: | G4 - - - | D4 - - - | A3 - - - | G3 - - - |
  seat center-right
  hall concert
  dynamics mp
cello: | G2 - - - | B2 - - - | C3 - D3 - | G2 - - - |
  seat right
  hall concert`,
  },
];
