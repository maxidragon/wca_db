-- Creates the user the Query Tool runs user-written SQL as, or resets an existing one to
-- exactly these rights. Any signed-in account can send the Query Tool its own SQL, so its
-- connection may read the app database and do nothing else: SELECT on that one database and
-- no global privilege at all. In particular no FILE, which reads and writes files on the
-- database host, and nothing that writes. SELECT is enough for DESC on tables and views and
-- for their INFORMATION_SCHEMA rows, which is all the Query Tool runs, so no SHOW VIEW.
--
-- Expects these session variables, which create_query_user.sh sets from .env:
--   @query_user, @query_host, @query_password, @query_database
-- Run it as an account that can create users and grant, such as root. Safe to re-run: it
-- updates the password and strips anything granted to the user by hand since.

-- Refuses to run without its variables, or for root or the account running it, which the
-- REVOKE below would strip of every right. A refused run leaves every statement after the
-- guard NULL, so none of them does anything even in a client that carries on past an error.
SET @query_refusal = CASE
  WHEN COALESCE(@query_user, '') = '' OR COALESCE(@query_host, '') = ''
    OR COALESCE(@query_password, '') = '' OR COALESCE(@query_database, '') = ''
    THEN 'Set @query_user, @query_host, @query_password and @query_database first'
  WHEN @query_user = 'root' OR CONCAT(@query_user, '@', @query_host) = CURRENT_USER()
    THEN 'The query user must be a user of its own'
END;
SET @guard = IF(
  @query_refusal IS NULL,
  'DO 0',
  CONCAT('SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ', QUOTE(@query_refusal))
);
PREPARE guard FROM @guard;
EXECUTE guard;
DEALLOCATE PREPARE guard;

SET @query_account = IF(
  @query_refusal IS NULL,
  CONCAT(QUOTE(@query_user), '@', QUOTE(@query_host)),
  NULL
);
-- `_` and `%` are wildcards in a database grant, so they are escaped to name this one only.
SET @query_grant_database = CONCAT(
  '`',
  REPLACE(REPLACE(REPLACE(@query_database, '`', '``'), '_', '\\_'), '%', '\\%'),
  '`'
);

SET @statement = CONCAT('CREATE USER IF NOT EXISTS ', @query_account);
PREPARE statement FROM @statement;
EXECUTE statement;
DEALLOCATE PREPARE statement;

-- The Query Tool wraps every statement in its own time limit; this one only catches a
-- statement that ever runs without it.
SET @statement = CONCAT(
  'ALTER USER ', @query_account,
  ' IDENTIFIED BY ', QUOTE(@query_password),
  ' WITH MAX_STATEMENT_TIME 60'
);
PREPARE statement FROM @statement;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @statement = CONCAT('REVOKE ALL PRIVILEGES, GRANT OPTION FROM ', @query_account);
PREPARE statement FROM @statement;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @statement = CONCAT('GRANT SELECT ON ', @query_grant_database, '.* TO ', @query_account);
PREPARE statement FROM @statement;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @query_password = NULL;
