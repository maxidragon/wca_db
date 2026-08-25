# Rewrite a mysqldump stream so every table is created with its primary key only.
#
# Secondary indexes and foreign keys are written to ALTER_FILE instead, to be applied once
# the data is in. InnoDB then builds each index by sorting the finished table, rather than
# doing one random B-tree insert per row per index while loading — which is what made the
# import slow, since a 128 MB buffer pool cannot hold the index pages being written.
#
# Usage: awk -v ALTER_FILE=indexes.sql -f defer_indexes.awk < dump.sql | mariadb db
#        mariadb db < indexes.sql   # after the data is loaded

/^CREATE TABLE `/ && !in_table {
  match($0, /`[^`]+`/)
  table = substr($0, RSTART + 1, RLENGTH - 2)
  in_table = 1
  kept = 0
  deferred = 0
  print
  next
}

# The closing ") ENGINE=..." line: emit the definitions we are keeping, and collect the
# rest into one ALTER TABLE so InnoDB builds them all in a single pass over the table.
in_table && /^\)/ {
  sub(/,[[:space:]]*$/, "", keep[kept])
  for (i = 1; i <= kept; i++) print keep[i]
  print
  if (deferred > 0) {
    alter = "ALTER TABLE `" table "`"
    for (i = 1; i <= deferred; i++) {
      definition = defer[i]
      sub(/^[[:space:]]+/, "", definition)
      sub(/,[[:space:]]*$/, "", definition)
      alter = alter (i == 1 ? " ADD " : ", ADD ") definition
    }
    print alter ";" > ALTER_FILE
  }
  in_table = 0
  next
}

# PRIMARY KEY stays: the clustered index is built as the rows are inserted either way.
in_table {
  if ($0 ~ /^[[:space:]]*(UNIQUE |FULLTEXT |SPATIAL )?KEY / || $0 ~ /^[[:space:]]*CONSTRAINT /)
    defer[++deferred] = $0
  else
    keep[++kept] = $0
  next
}

{ print }
