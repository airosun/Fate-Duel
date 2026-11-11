// Pronouns for servants (from the design spreadsheet). pro(servant) -> forms for log and description text.
const FORMS = {
  'he/him':    { they: 'he', them: 'him', their: 'his', themself: 'himself', plural: false },
  'she/her':   { they: 'she', them: 'her', their: 'her', themself: 'herself', plural: false },
  'they/them': { they: 'they', them: 'them', their: 'their', themself: 'themself', plural: true },
};
export function pro(servant) {
  return FORMS[servant?.pronouns] ?? FORMS['they/them'];
}
// Verb agreement: pro(s).plural ? 'keep' : 'keeps'
export const verb = (servant, singular, plural) => (pro(servant).plural ? plural : singular);
