// resolveEmailGroup — maps (groupID, category) to the sendMail `group` key.
//
// category 'ops'  : Arrival, Dispatch, Balance  → bhiwandi@ for BHW, group SMTP for others
// category 'fin'  : Bill, Receipt               → accounts@ for BHW, group SMTP for others
//
// .env SMTP keys referenced:
//   undefined / ''  → SMTP_*           (default = bhiwandi@adityaservices.co.in)
//   'BHW'           → SMTP_BHW_*       (accounts@adityaservices.co.in)
//   'VLCO'          → SMTP_VLCO_*      (veljilukhamsi@gmail.com)

function resolveEmailGroup(groupID, category) {
  const g = (groupID || '').toUpperCase();
  if (g === 'BHW') {
    // ops pages use the default (bhiwandi@); fin pages use the BHW SMTP (accounts@)
    return category === 'fin' ? 'BHW' : undefined;
  }
  // All other groups (VLCO, etc.) use their own SMTP config as-is
  return g || undefined;
}

module.exports = { resolveEmailGroup };
