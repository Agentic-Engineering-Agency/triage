// Barrel export — all Mastra tools for registration in the Mastra instance.
//
// Koki's implementation names (kebab-case IDs, used in tests):
//   createLinearIssue, updateLinearIssue, getLinearIssue, searchLinearIssues, getLinearTeamMembers
//   sendTicketNotification, sendResolutionNotification
//
// Lalo's scaffold names (used in agent registrations):
//   createLinearIssueTool, updateLinearIssueTool, getLinearIssueTool, listLinearIssuesTool, getTeamMembersTool
//   sendTicketEmailTool, sendResolutionEmailTool
//
// Both sets of names are exported — they are aliases to the same createTool() objects.

export {
  createLinearIssue,
  updateLinearIssue,
  getLinearIssue,
  searchLinearIssues,
  getLinearTeamMembers,
  // Aliases for Lalo's agents
  createLinearIssueTool,
  updateLinearIssueTool,
  getLinearIssueTool,
  listLinearIssuesTool,
  getTeamMembersTool,
} from './linear';

export {
  sendTicketNotification,
  sendResolutionNotification,
  // Aliases for Lalo's agents
  sendTicketEmailTool,
  sendResolutionEmailTool,
} from './resend';

export { queryWikiTool } from './wiki-query';

export { generateWikiTool } from './wiki-generate';
