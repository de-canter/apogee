export interface Contact {
  id: string;
  name: string;
  role?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
}

export interface ContactGridProps {
  contacts: Contact[];
  onCall?: ((contact: Contact) => void) | undefined;
  onEmail?: ((contact: Contact) => void) | undefined;
  onMessage?: ((contact: Contact) => void) | undefined;
  onEdit?: ((contact: Contact) => void) | undefined;
  onDelete?: ((contact: Contact) => void) | undefined;
}

export function ContactGrid({
  contacts,
  onCall,
  onEmail,
  onMessage,
  onEdit,
  onDelete,
}: ContactGridProps) {
  if (contacts.length === 0) {
    return <div className="gc-contact-grid-empty">No contacts</div>;
  }

  return (
    <div className="gc-contact-grid">
      <table className="gc-contact-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Phone</th>
            <th>Email</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact) => (
            <tr key={contact.id}>
              <td className="gc-contact-name">{contact.name}</td>
              <td className="gc-contact-role">{contact.role ?? '\u2014'}</td>
              <td className="gc-contact-phone">{contact.phone ?? '\u2014'}</td>
              <td className="gc-contact-email">{contact.email ?? '\u2014'}</td>
              <td className="gc-contact-actions">
                {onCall && (
                  contact.phone ? (
                    <button
                      className="gc-contact-action-btn"
                      title="Call"
                      onClick={() => onCall(contact)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                      </svg>
                    </button>
                  ) : (
                    <span className="gc-contact-action-btn" style={{ opacity: 0.2, cursor: 'default' }}>{'\u2014'}</span>
                  )
                )}
                {onEmail && (
                  contact.email ? (
                    <button
                      className="gc-contact-action-btn"
                      title="Email"
                      onClick={() => onEmail(contact)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="M22 7l-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" />
                      </svg>
                    </button>
                  ) : (
                    <span className="gc-contact-action-btn" style={{ opacity: 0.2, cursor: 'default' }}>{'\u2014'}</span>
                  )
                )}
                {onMessage && (
                  <button
                    className="gc-contact-action-btn"
                    title="Message"
                    onClick={() => onMessage(contact)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                  </button>
                )}
                {onEdit && (
                  <button
                    className="gc-contact-action-btn"
                    title="Edit"
                    onClick={() => onEdit(contact)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                    </svg>
                  </button>
                )}
                {onDelete && (
                  <button
                    className="gc-contact-action-btn gc-contact-action-btn--danger"
                    title="Remove"
                    onClick={() => onDelete(contact)}
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeLinecap="round">
                      <circle cx="10" cy="10" r="7.5" strokeWidth="1.25" opacity="0.5" />
                      <line x1="7" y1="7" x2="13" y2="13" strokeWidth="1.5" />
                      <line x1="13" y1="7" x2="7" y2="13" strokeWidth="1.5" />
                    </svg>
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
