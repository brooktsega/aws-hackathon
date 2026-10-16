// One-time consent before the first analysis (R11.2).
import { openDialog } from '../ui/dialog';
import { h } from '../ui/dom';

export async function askDisclosure(): Promise<boolean> {
  const accepted = await openDialog<boolean>({
    title: 'Send this email to Anthropic?',
    content: h(
      'div',
      null,
      h('p', null, "When you click “Analyze this email”, the text of the email you have open is sent to Anthropic's Claude API using your API key, so Claude can identify the company, role, and status."),
      h('p', { className: 'muted small' }, 'Nothing is sent until you click, and only the open email is sent. Results are stored only in this browser.'),
    ),
    actions: [
      { label: 'Cancel', value: false },
      { label: 'I understand, continue', value: true, kind: 'primary' },
    ],
  });
  return accepted === true;
}
