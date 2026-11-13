from datetime import date

import pytest

from leaves import (
    FLOATING,
    VACATION,
    Booking,
    Entry,
    Step,
    NotBookable,
    Placement,
    bookable_span,
    booked_dates,
    canada_holidays,
    floating_left,
    holiday_dates,
    parse_entries,
    parse_balances,
    plan_paid_year_end,
    plan_quota,
    take_whole_days,
    time_off,
    year_end_entries,
    year_end_runs,
)

TODAY = date(2026, 11, 13)
LISTING = """Christmas Day (1 day)
Fri, Dec 25, 2026
Holiday
Object Status
Boxing Day (1 day)
Mon, Dec 28, 2026
Holiday
Object Status
Vacation (2 days)
Tue, Dec 29 \u2013 Wed, Dec 30, 2026
Pending
Vacation (0.5 days)
Thu, Dec 31, 2026
Pending
"""
ENTRIES = parse_entries(LISTING)
HOLIDAYS = holiday_dates(ENTRIES) | canada_holidays(2026)
BOOKED = booked_dates(ENTRIES)
TWO_DAYS = ENTRIES[2]
HALF_DAY = ENTRIES[3]


def test_parses_bookings_and_holidays_from_the_absences_listing():
    assert [(e.name, e.days, e.start, e.end, e.status) for e in ENTRIES] == [
        ("Christmas Day", 1.0, date(2026, 12, 25), date(2026, 12, 25), "Holiday"),
        ("Boxing Day", 1.0, date(2026, 12, 28), date(2026, 12, 28), "Holiday"),
        ("Vacation", 2.0, date(2026, 12, 29), date(2026, 12, 30), "Pending"),
        ("Vacation", 0.5, date(2026, 12, 31), date(2026, 12, 31), "Pending"),
    ]
    assert BOOKED == {date(2026, 12, 29), date(2026, 12, 30), date(2026, 12, 31)}


def test_a_range_books_one_request_per_run_and_keeps_weekends_inside_a_run():
    runs, skipped = bookable_span(date(2026, 11, 19), date(2026, 11, 24), False, HOLIDAYS, BOOKED, TODAY)
    assert runs == [Placement(date(2026, 11, 19), date(2026, 11, 24), 4.0)]
    assert [reason for _, reason in skipped] == ["weekend", "weekend"]


def test_a_range_skips_public_holidays_and_already_booked_days():
    runs, skipped = bookable_span(date(2026, 12, 21), date(2026, 12, 31), False, HOLIDAYS, BOOKED, TODAY)
    assert runs == [Placement(date(2026, 12, 21), date(2026, 12, 24), 4.0)]
    assert {reason for _, reason in skipped} == {"weekend", "public holiday", "already booked"}


def test_a_holiday_inside_a_range_splits_it_into_two_requests():
    runs, _ = bookable_span(date(2026, 6, 30), date(2026, 7, 2), False, HOLIDAYS, set(), TODAY.replace(month=6, day=1))
    assert runs == [
        Placement(date(2026, 6, 30), date(2026, 6, 30), 1.0),
        Placement(date(2026, 7, 2), date(2026, 7, 2), 1.0),
    ]


@pytest.mark.parametrize(
    "day",
    [date(2026, 11, 21), date(2026, 12, 25), date(2026, 12, 29), date(2026, 11, 12)],
    ids=["weekend", "public holiday", "already booked", "past"],
)
def test_a_range_with_nothing_bookable_fails(day):
    with pytest.raises(NotBookable):
        bookable_span(day, day, False, HOLIDAYS, BOOKED, TODAY)


def test_a_half_day_must_be_a_single_date():
    with pytest.raises(NotBookable):
        bookable_span(date(2026, 11, 23), date(2026, 11, 24), True, HOLIDAYS, BOOKED, TODAY)


def test_year_end_puts_the_half_day_last_and_skips_holidays():
    assert year_end_runs(2.5, 2026, HOLIDAYS, set(), TODAY) == [
        Placement(date(2026, 12, 29), date(2026, 12, 30), 2.0),
        Placement(date(2026, 12, 31), date(2026, 12, 31), 0.5),
    ]


def test_year_end_skips_days_already_booked():
    assert year_end_runs(2, 2026, HOLIDAYS, BOOKED, TODAY) == [
        Placement(date(2026, 12, 23), date(2026, 12, 24), 2.0),
    ]


def test_year_end_rejects_quarter_days():
    with pytest.raises(NotBookable):
        year_end_runs(1.25, 2026, HOLIDAYS, set(), TODAY)


def test_within_quota_everything_is_a_new_request():
    runs = [Placement(date(2026, 11, 23), date(2026, 11, 24), 2.0)]
    assert plan_quota(runs, 3, [TWO_DAYS, HALF_DAY], HOLIDAYS) == plan_quota(runs, 3, [], HOLIDAYS)
    assert plan_quota(runs, 3, [], HOLIDAYS).new_requests == runs


def test_without_quota_year_end_bookings_are_edited_onto_the_range():
    runs = [Placement(date(2026, 11, 23), date(2026, 11, 24), 2.0)]
    plan = plan_quota(runs, -1.5, year_end_entries(ENTRIES, "Vacation", 2026, runs[0].start, runs[0].end), HOLIDAYS)
    assert plan.edits == [(TWO_DAYS, runs[0])]
    assert plan.shrinks == [] and plan.new_requests == []


def test_a_single_day_shortens_a_longer_year_end_booking_instead_of_moving_it():
    runs = [Placement(date(2026, 11, 23), date(2026, 11, 23), 1.0)]
    plan = plan_quota(runs, 0, [HALF_DAY, TWO_DAYS], HOLIDAYS)
    assert plan.edits == []
    assert plan.shrinks == [(TWO_DAYS, Placement(date(2026, 12, 29), date(2026, 12, 29), 1.0))]
    assert plan.new_requests == runs


def test_no_quota_and_nothing_to_move_fails():
    runs = [Placement(date(2026, 11, 23), date(2026, 11, 25), 3.0)]
    with pytest.raises(NotBookable):
        plan_quota(runs, 0, [HALF_DAY], HOLIDAYS)


def test_year_end_bookings_inside_the_range_are_not_moved():
    candidates = year_end_entries(ENTRIES, "Vacation", 2026, date(2026, 12, 21), date(2026, 12, 31))
    assert candidates == []


def test_parses_the_balance_overview_and_lists_only_time_off():
    overview = "Balance Overview\nTime Type\n\tAnnual Balance\n\tVolunteer Hours\t24:00 hours\t\n\tFloating Holiday\t3 days\t\nClose"
    assert parse_balances(overview) == {"Volunteer Hours": "24:00 hours", "Floating Holiday": "3 days"}
    assert time_off(ENTRIES) == [TWO_DAYS, HALF_DAY]


def test_time_off_filters_by_type_and_leaves_out_the_past():
    past = Entry("Vacation", 1.0, date(2026, 3, 2), date(2026, 3, 2), "Approved")
    floating = Entry("Floating Holiday", 1.0, date(2026, 12, 1), date(2026, 12, 1), "Pending")
    entries = ENTRIES + [past, floating]
    assert time_off(entries, "Vacation", TODAY) == [TWO_DAYS, HALF_DAY]
    assert time_off(entries, "Floating Holiday", TODAY) == [floating]


def test_entries_are_frozen_so_they_can_be_compared():
    assert Entry("Vacation", 1.0, TODAY, TODAY, "Pending") == Entry("Vacation", 1.0, TODAY, TODAY, "Pending")


def test_year_end_paid_leave_uses_floating_first_by_converting_vacation_placeholders():
    steps = plan_paid_year_end(ENTRIES, 3.0, -1.5, None, 2026, HOLIDAYS, TODAY)
    assert steps == [
        Step(HALF_DAY, Booking(VACATION, Placement(date(2026, 12, 24), date(2026, 12, 24), 1.0)), False),
        Step(TWO_DAYS, Booking(FLOATING, Placement(date(2026, 12, 29), date(2026, 12, 31), 3.0)), True),
    ]


def test_year_end_paid_leave_fails_when_nothing_is_left():
    with pytest.raises(NotBookable, match="no remaining quota"):
        plan_paid_year_end([], 0.0, 0.0, None, 2026, HOLIDAYS, TODAY)


def test_year_end_paid_leave_fails_when_more_days_are_asked_than_left():
    with pytest.raises(NotBookable, match="1.5 paid day"):
        plan_paid_year_end(ENTRIES, 3.0, -1.5, 2.0, 2026, HOLIDAYS, TODAY)


def test_year_end_overbooking_without_floating_asks_to_cancel():
    with pytest.raises(NotBookable, match="exceed the paid leave left by 1.5"):
        plan_paid_year_end(ENTRIES, 0.0, -1.5, None, 2026, HOLIDAYS, TODAY)


def test_floating_takes_the_first_whole_days_of_a_range():
    run = Placement(date(2026, 11, 19), date(2026, 11, 24), 4.0)
    assert take_whole_days([run], 3.0, HOLIDAYS) == (
        [Placement(date(2026, 11, 19), date(2026, 11, 23), 3.0)],
        [Placement(date(2026, 11, 24), date(2026, 11, 24), 1.0)],
    )


def test_floating_left_is_the_annual_grant_less_this_years_floating_bookings():
    booked = Entry(FLOATING, 3.0, date(2026, 12, 29), date(2026, 12, 31), "Pending")
    last_year = Entry(FLOATING, 1.0, date(2025, 12, 31), date(2025, 12, 31), "Approved")
    assert floating_left(3.0, [*ENTRIES, booked, last_year], 2026) == 0.0
