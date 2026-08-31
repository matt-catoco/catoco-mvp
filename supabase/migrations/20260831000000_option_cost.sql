-- Flow #2 follow-up: optional `cost` on cost-bearing option types
-- (travel / accommodation / experience / dining). Number in the trip's budget
-- currency; used later by the financing flow for projected-vs-target spend.
--
-- Only the validation function changes — `create or replace`, safe to re-run.

create or replace function public.validate_option_value(p_type text, p_value jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'option value for % must be an object', p_type;
  end if;

  if p_type = 'dates' then
    if coalesce(p_value->>'start', '') = '' or coalesce(p_value->>'end', '') = '' then
      raise exception 'dates needs a start and end';
    end if;
    if (p_value->>'end')::date < (p_value->>'start')::date then
      raise exception 'dates end is before start';
    end if;

  elsif p_type = 'destination' then
    if coalesce(btrim(p_value->>'name'), '') = '' then
      raise exception 'destination needs a name';
    end if;

  elsif p_type = 'budget' then
    if jsonb_typeof(p_value->'amount') <> 'number' or (p_value->>'amount')::numeric <= 0 then
      raise exception 'budget needs a positive amount';
    end if;
    if coalesce(btrim(p_value->>'currency'), '') = '' then
      raise exception 'budget needs a currency';
    end if;

  elsif p_type = 'participants' then
    if jsonb_typeof(p_value->'count') <> 'number'
       or (p_value->>'count')::numeric <= 0
       or (p_value->>'count')::numeric <> floor((p_value->>'count')::numeric) then
      raise exception 'participants needs a positive whole number';
    end if;

  elsif p_type = 'travel' then
    if coalesce(btrim(p_value->>'mode'), '') = '' then
      raise exception 'travel needs a mode';
    end if;

  elsif p_type in ('accommodation', 'experience', 'dining') then
    if coalesce(btrim(p_value->>'name'), '') = '' then
      raise exception '% needs a name', p_type;
    end if;

  else
    raise exception 'unknown element type: %', p_type;
  end if;

  -- Optional cost on cost-bearing option types.
  if p_type in ('travel', 'accommodation', 'experience', 'dining')
     and p_value ? 'cost'
     and jsonb_typeof(p_value->'cost') <> 'null' then
    if jsonb_typeof(p_value->'cost') <> 'number' or (p_value->>'cost')::numeric < 0 then
      raise exception '% cost must be a number of 0 or more', p_type;
    end if;
  end if;
end;
$$;
