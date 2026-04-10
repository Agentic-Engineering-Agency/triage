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
  listLinearCycles,
  // Aliases for Lalo's agents
  createLinearIssueTool,
  updateLinearIssueTool,
  getLinearIssueTool,
  listLinearIssuesTool,
  getTeamMembersTool,
  listLinearCyclesTool,
} from './linear';

export {
  sendTicketNotification,
  sendResolutionNotification,
  // Aliases for Lalo's agents
  sendTicketEmailTool,
  sendResolutionEmailTool,
} from './resend';

export {
  sendSlackTicketNotification,
  sendSlackResolutionNotification,
  sendSlackMessage,
  // Aliases for agent registrations
  sendSlackTicketNotificationTool,
  sendSlackResolutionNotificationTool,
  sendSlackMessageTool,
} from './slack';

export { queryWikiTool } from './wiki-query';

export { generateWikiTool } from './wiki-generate';

export { processAttachmentsTool } from './attachments';
export { displayTriageTool } from './display-triage';
export { displayDuplicateTool } from './display-duplicate';
export { commentOnGitHubPRTool } from './github';
