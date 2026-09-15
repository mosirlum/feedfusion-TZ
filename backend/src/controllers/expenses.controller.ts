import { Request, Response, NextFunction } from 'express';
import * as expensesService from '../services/expenses.service';

export async function createExpenseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { category, amount, description, expenseDate, expenseType } = req.body ?? {};
    const expense = await expensesService.createExpense({
      category,
      amount,
      description,
      expenseDate,
      expenseType,
      createdBy: req.user!,
    });
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
}

export async function listExpensesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const expenseType = typeof req.query.expense_type === 'string' ? req.query.expense_type : undefined;
    res.status(200).json(await expensesService.listExpenses({ from, to, expenseType }));
  } catch (err) {
    next(err);
  }
}
