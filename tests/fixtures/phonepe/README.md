These fixtures follow the eight-column CSV and positioned PDF transaction table
inspected in the supplied September–October 2026 PhonePe samples. Every account
name, party, reference, instrument and transaction date has been replaced with
synthetic data. The original documents are never copied into this repository.

The PDF line fixture reproduces the observed ordering: date/payee/type/amount,
then time/transaction ID, UTR No., and payment instrument. Tests also generate
an in-memory text PDF from these lines and pass it through the real PDF.js reader.
Additional credit, wrapped-text and multiple-page cases are synthetic extensions.
