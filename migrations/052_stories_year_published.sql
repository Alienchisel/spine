-- Stories Layer 4 pass 1: per-story publication year.
--
-- Foundation for the cross-collection chronological reading view that
-- comes in pass 2. A user can populate the year on each story in a
-- collection (e.g. all Gene Wolfe stories across multiple omnibuses)
-- and later list "unread Wolfe stories, sorted by year." Nullable —
-- existing stories aren't touched, and the form may simply omit the
-- field for collections where the printing year of each piece isn't
-- worth chasing down.

ALTER TABLE stories ADD COLUMN year_published INTEGER;
