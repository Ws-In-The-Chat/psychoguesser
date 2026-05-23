// Shared psychologist avatar list — used by both the browser (window.PSYCHOLOGISTS)
// and the server (require) so avatar uniqueness can be enforced authoritatively.
(function () {
  const PSYCHOLOGISTS = [
    { id:'freud',     name:'Sigmund Freud',       short:'SF', color:'#ff6b3d', wiki:'Sigmund_Freud' },
    { id:'jung',      name:'Carl Jung',            short:'CJ', color:'#ff9d3c', wiki:'Carl_Jung' },
    { id:'skinner',   name:'B.F. Skinner',         short:'BF', color:'#3b82f6', wiki:'B._F._Skinner' },
    { id:'pavlov',    name:'Ivan Pavlov',           short:'IP', color:'#22c55e', wiki:'Ivan_Pavlov' },
    { id:'piaget',    name:'Jean Piaget',           short:'JP', color:'#f59e0b', wiki:'Jean_Piaget' },
    { id:'maslow',    name:'Abraham Maslow',        short:'AM', color:'#f97316', wiki:'Abraham_Maslow' },
    { id:'james',     name:'William James',         short:'WJ', color:'#ec4899', wiki:'William_James' },
    { id:'wundt',     name:'Wilhelm Wundt',         short:'WW', color:'#14b8a6', wiki:'Wilhelm_Wundt' },
    { id:'milgram',   name:'Stanley Milgram',       short:'SM', color:'#ef4444', wiki:'Stanley_Milgram' },
    { id:'zimbardo',  name:'Philip Zimbardo',       short:'PZ', color:'#ff4d8d', wiki:'Philip_Zimbardo' },
    { id:'bandura',   name:'Albert Bandura',        short:'AB', color:'#0ea5e9', wiki:'Albert_Bandura' },
    { id:'rogers',    name:'Carl Rogers',           short:'CR', color:'#84cc16', wiki:'Carl_Rogers' },
    { id:'erikson',   name:'Erik Erikson',          short:'EE', color:'#f43f5e', wiki:'Erik_Erikson' },
    { id:'vygotsky',  name:'Lev Vygotsky',          short:'LV', color:'#ff9d3c', wiki:'Lev_Vygotsky' },
    { id:'beck',      name:'Aaron Beck',            short:'AK', color:'#10b981', wiki:'Aaron_T._Beck' },
    { id:'watson',    name:'John Watson',           short:'JW', color:'#fb923c', wiki:'John_B._Watson' },
    { id:'adler',     name:'Alfred Adler',          short:'AA', color:'#e879f9', wiki:'Alfred_Adler' },
    { id:'afreud',    name:'Anna Freud',            short:'AN', color:'#38bdf8', wiki:'Anna_Freud' },
    { id:'allport',   name:'Gordon Allport',        short:'GA', color:'#4ade80', wiki:'Gordon_Allport' },
    { id:'wertheimer',name:'Max Wertheimer',        short:'MW', color:'#fbbf24', wiki:'Max_Wertheimer' },
    { id:'thorndike', name:'Edward Thorndike',      short:'ET', color:'#f472b6', wiki:'Edward_Thorndike' },
    { id:'harlow',    name:'Harry Harlow',          short:'HH', color:'#ff6b3d', wiki:'Harry_Harlow' },
    { id:'festinger', name:'Leon Festinger',        short:'LF', color:'#34d399', wiki:'Leon_Festinger' },
    { id:'miller',    name:'George Miller',         short:'GM', color:'#fb7185', wiki:'George_Armitage_Miller' },
    { id:'loftus',    name:'Elizabeth Loftus',      short:'EL', color:'#ff9d6b', wiki:'Elizabeth_Loftus' },
    { id:'kahneman',  name:'Daniel Kahneman',       short:'DK', color:'#67e8f9', wiki:'Daniel_Kahneman' },
    { id:'seligman',  name:'Martin Seligman',       short:'MG', color:'#86efac', wiki:'Martin_Seligman' },
    { id:'ellis',     name:'Albert Ellis',          short:'AE', color:'#fde68a', wiki:'Albert_Ellis' },
    { id:'frankl',    name:'Viktor Frankl',         short:'VF', color:'#ff8a5c', wiki:'Viktor_Frankl' },
    { id:'lewin',     name:'Kurt Lewin',            short:'KL', color:'#bae6fd', wiki:'Kurt_Lewin' },
    { id:'wechsler',  name:'David Wechsler',        short:'DW', color:'#bbf7d0', wiki:'David_Wechsler' },
    { id:'binet',     name:'Alfred Binet',          short:'BN', color:'#fed7aa', wiki:'Alfred_Binet' },
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = { PSYCHOLOGISTS };
  if (typeof window !== 'undefined') window.PSYCHOLOGISTS = PSYCHOLOGISTS;
})();
