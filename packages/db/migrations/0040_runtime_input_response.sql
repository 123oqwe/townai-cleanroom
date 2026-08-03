alter table session_runs
  add column input_response text;

alter table session_runs
  add constraint session_runs_input_response_nonempty
  check (input_response is null or length(btrim(input_response)) > 0);
