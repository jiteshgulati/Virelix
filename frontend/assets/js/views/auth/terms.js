import { html } from "../../core/dom.js";
import { authLayout } from "../../components/auth-layout.js";

export default function terms(root) {
  authLayout(root, html`
    <div><div class="eyebrow">Virelix</div><h1 class="mt-2">Terms of use</h1>
      <p class="sub">How this Virelix installation handles your account and data.</p></div>
    <div class="vx-stack">
      <p><strong>Service.</strong> Virelix lets you search a shared document collection and your own private text files. It's provided as is, without uptime or support commitments.</p>
      <p><strong>Your data.</strong> Your account, search history, saved results, collections and preferences are stored on the server that runs this installation. Private attachments are kept for 24 hours, are visible only to you, and are never added to the shared corpus.</p>
      <p><strong>Administrators.</strong> Admins and the Owner can see account details: your name, email, role, status and sign-in times. They can't read your history, saved items, collections or attachments.</p>
      <p><strong>Email.</strong> This installation may not deliver email. If it doesn't, verification and password-reset links are issued by the server operator.</p>
      <p><strong>Acceptable use.</strong> Upload only text you have the right to use, and don't attempt to access other people's data.</p>
      <p><a href="/register">Back to registration</a></p>
    </div>`);
}
