-- Tighten `condition` semantics: it applies only to currently-owned
-- physical books. BookForm and BookDetail are updated in the same
-- commit to hide the field when owned=0, so previously-owned rows
-- with a lingering condition would render in the DB but never be
-- visible or editable. Clear them so DB matches what the UI lets
-- the user see and edit.
UPDATE books SET condition = NULL
 WHERE owned = 0 AND previously_owned = 1 AND condition IS NOT NULL;
