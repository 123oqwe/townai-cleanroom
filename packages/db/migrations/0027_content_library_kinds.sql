alter table content_items
  drop constraint content_items_kind_allowed;
alter table content_items
  add constraint content_items_kind_allowed check (
    kind in (
      'document', 'email_draft', 'spreadsheet', 'deck', 'file', 'image',
      'video', 'audio', 'recording', 'briefing', 'link', 'session'
    )
  );
